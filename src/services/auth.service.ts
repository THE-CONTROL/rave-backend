import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { generateOtp, generateReferralCode, otpExpiresAt } from "../utils";
import { issueTokenPair, verifyRefreshToken } from "../utils/jwt";
import { sendOtpEmail, sendWelcomeEmail } from "../utils/email";
import {
  SignUpDto,
  SignInDto,
  VerifyEmailDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  TokenPair,
  SignInResult,
} from "../types";

const SALT_ROUNDS = 12;

// ─────────────────────────────────────────────────────────────────────────────
// Sign Up
// ─────────────────────────────────────────────────────────────────────────────

export const signUp = async (dto: SignUpDto): Promise<void> => {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: dto.email }, { phone: dto.phoneNumber }] },
  });

  if (existing) {
    throw AppError.conflict(
      existing.email === dto.email
        ? "An account with this email already exists."
        : "An account with this phone number already exists.",
    );
  }

  const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

  // ── Batch user + profile creation in one transaction ─────────────────────
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        fullName: dto.name,
        email: dto.email,
        phone: dto.phoneNumber,
        passwordHash,
        role: dto.role,
        referralCode: generateReferralCode(),
        notificationSettings: { create: {} },
      },
    });

    if (dto.role === "vendor") {
      await tx.vendorProfile.create({
        data: { userId: created.id, storeName: `${dto.name}'s Store` },
      });
    }

    if (dto.role === "rider") {
      await tx.riderProfile.create({ data: { userId: created.id } });
    }

    return created;
  });

  // ── OTP persisted before responding; email is fire-and-forget ─────────────
  const otp = generateOtp();

  await prisma.otpCode.create({
    data: {
      code: otp,
      purpose: "verify-account",
      userId: user.id,
      expiresAt: otpExpiresAt(10),
    },
  });

  // sendOtpEmail is now void — fire-and-forget is handled inside the helper
  sendOtpEmail(user.email, user.fullName, otp, "verify-account");
};

// ─────────────────────────────────────────────────────────────────────────────
// Verify Email (OTP)
// ─────────────────────────────────────────────────────────────────────────────

export const verifyEmail = async (
  dto: VerifyEmailDto,
): Promise<{ purpose: string; tokens?: TokenPair; role: Role }> => {
  const otpRecord = await prisma.otpCode.findFirst({
    where: {
      code: dto.code,
      purpose: dto.purpose,
      used: false,
      user: { email: dto.email },
    },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });

  if (!otpRecord || otpRecord.expiresAt < new Date()) {
    throw AppError.badRequest("Invalid or expired OTP code.");
  }

  await prisma.otpCode.update({
    where: { id: otpRecord.id },
    data: { used: true },
  });

  if (dto.purpose === "verify-account") {
    // Mark verified + open session in parallel — independent operations
    const [tokens] = await Promise.all([
      _createSession(
        otpRecord.user.id,
        otpRecord.user.role,
        otpRecord.user.email,
      ),
      prisma.user.update({
        where: { id: otpRecord.userId },
        data: { isEmailVerified: true },
      }),
    ]);

    // Fire-and-forget — welcome email must never delay the login response.
    // Fixed: was previously sending to a hardcoded address.
    sendWelcomeEmail(otpRecord.user.email, otpRecord.user.fullName);

    return { purpose: "verify-account", tokens, role: otpRecord.user.role };
  }

  return { purpose: "reset-password", role: otpRecord.user.role };
};

// ─────────────────────────────────────────────────────────────────────────────
// Sign In
// ─────────────────────────────────────────────────────────────────────────────

export const signIn = async (dto: SignInDto): Promise<SignInResult> => {
  const user = await prisma.user.findUnique({ where: { email: dto.email } });

  if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
    throw AppError.badRequest("Invalid email or password.");
  }

  if (!user.isEmailVerified) {
    throw AppError.unauthorized("Please verify your email before signing in.");
  }

  if (!user.isActive) {
    throw AppError.forbidden("Your account has been deactivated.");
  }

  const tokens = await _createSession(user.id, user.role, user.email);

  return {
    status: "complete",
    role: user.role as any,
    tokens,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Refresh Tokens
// ─────────────────────────────────────────────────────────────────────────────

export const refreshTokens = async (
  refreshToken: string,
): Promise<TokenPair> => {
  const payload = verifyRefreshToken(refreshToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
  });

  if (!stored || stored.expiresAt < new Date()) {
    throw AppError.unauthorized("Refresh token is invalid or expired.");
  }

  await prisma.refreshToken.delete({ where: { id: stored.id } });

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw AppError.unauthorized();

  return _createSession(user.id, user.role, user.email);
};

// ─────────────────────────────────────────────────────────────────────────────
// Forgot Password
// ─────────────────────────────────────────────────────────────────────────────

export const forgotPassword = async (dto: ForgotPasswordDto): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { email: dto.email } });
  if (!user) return; // Silent return — don't leak whether the email exists

  const otp = generateOtp();

  await prisma.otpCode.create({
    data: {
      code: otp,
      purpose: dto.purpose,
      userId: user.id,
      expiresAt: otpExpiresAt(10),
    },
  });

  sendOtpEmail(user.email, user.fullName, otp, "reset-password");
};

// ─────────────────────────────────────────────────────────────────────────────
// Reset Password
// ─────────────────────────────────────────────────────────────────────────────

export const resetPassword = async (
  userId: string,
  dto: ResetPasswordDto,
): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw AppError.unauthorized("User not found.");
  }

  const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

  // Invalidate all sessions + update password atomically
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
  ]);
};

// ─────────────────────────────────────────────────────────────────────────────
// Resend OTP
// ─────────────────────────────────────────────────────────────────────────────

export const resendCode = async (dto: ForgotPasswordDto): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { email: dto.email } });
  if (!user) return;

  // Invalidate all previous unused codes + create new one atomically
  const otp = generateOtp();

  await prisma.$transaction([
    prisma.otpCode.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    }),
    prisma.otpCode.create({
      data: {
        code: otp,
        purpose: dto.purpose,
        userId: user.id,
        expiresAt: otpExpiresAt(10),
      },
    }),
  ]);

  sendOtpEmail(user.email, user.fullName, otp, dto.purpose);
};

// ─────────────────────────────────────────────────────────────────────────────
// Sign Out
// ─────────────────────────────────────────────────────────────────────────────

export const signOut = async (
  userId: string,
  refreshToken?: string,
): Promise<void> => {
  if (refreshToken) {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  } else {
    await prisma.refreshToken.deleteMany({ where: { userId } });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Update Push Token
// ─────────────────────────────────────────────────────────────────────────────

export const updatePushToken = async (
  userId: string,
  token: string,
): Promise<void> => {
  await prisma.user.update({
    where: { id: userId },
    data: { pushToken: token },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

const _createSession = async (
  userId: string,
  role: Role,
  email: string,
): Promise<TokenPair> => {
  const tokenPair = issueTokenPair(userId, role, email);

  const refreshExpiry = new Date();
  refreshExpiry.setDate(refreshExpiry.getDate() + 30);

  await prisma.refreshToken.create({
    data: {
      token: tokenPair.refreshToken,
      userId,
      expiresAt: refreshExpiry,
    },
  });

  return tokenPair;
};
