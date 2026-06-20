// src/services/auth.service.ts
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

  const user = await prisma.user.create({
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

  const otp = generateOtp();

  const profileCreate =
    dto.role === "vendor"
      ? prisma.vendorProfile.create({
          data: { userId: user.id, storeName: dto.name + "'s Store" },
        })
      : dto.role === "rider"
        ? prisma.riderProfile.create({ data: { userId: user.id } })
        : Promise.resolve();

  const otpCreate = prisma.otpCode.create({
    data: {
      code: otp,
      purpose: "verify-account",
      userId: user.id,
      expiresAt: otpExpiresAt(10),
    },
  });

  await Promise.all([profileCreate, otpCreate]);

  // If the user signed up with a referral code, record the referral link now
  // (status "pending"). The bonus is paid later, once they complete a
  // qualifying first order. A bad/own code is ignored so it never blocks
  // signup — the field is optional and best-effort.
  if (dto.referralCode) {
    try {
      const referrer = await prisma.user.findFirst({
        where: { referralCode: dto.referralCode },
        select: { id: true },
      });
      if (referrer && referrer.id !== user.id) {
        await prisma.referral.create({
          data: { referrerId: referrer.id, refereeId: user.id },
        });
      }
    } catch {
      // ignore — referral is non-critical to account creation
    }
  }

  // Fix: fire-and-forget — DB succeeded, don't crash the signup over email
  sendOtpEmail(
    "lawsonekhorutomwen@gmail.com",
    user.fullName,
    otp,
    "verify-account",
  ).catch((err) => {});
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

  // Mark OTP used + verify user email concurrently — neither depends on the other
  const markUsed = prisma.otpCode.update({
    where: { id: otpRecord.id },
    data: { used: true },
  });

  if (dto.purpose === "verify-account") {
    const markVerified = prisma.user.update({
      where: { id: otpRecord.userId },
      data: { isEmailVerified: true },
    });

    // All three run concurrently: mark OTP, verify user, create session
    const [, , tokens] = await Promise.all([
      markUsed,
      markVerified,
      _createSession(
        otpRecord.user.id,
        otpRecord.user.role,
        otpRecord.user.email,
      ),
    ]);

    // Welcome email is fire-and-forget — no reason to make the client wait
    sendWelcomeEmail(otpRecord.user.email, otpRecord.user.fullName).catch(
      (err) => {},
    );

    return { purpose: "verify-account", tokens, role: otpRecord.user.role };
  }

  await markUsed;
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
    role: user.role as any, // Return the role for frontend routing
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

  // Rotate: delete old, issue new
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
  if (!user) return;

  const otp = generateOtp();
  await prisma.otpCode.create({
    data: {
      code: otp,
      purpose: dto.purpose,
      userId: user.id,
      expiresAt: otpExpiresAt(10),
    },
  });

  // Fix: fire-and-forget — OTP is saved, don't crash if email provider is down
  sendOtpEmail(user.email, user.fullName, otp, "reset-password").catch(
    (err) => {},
  );
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

  // Verification that password and confirmPassword match is handled by Zod validator
  // We do NOT check the current password here because this is the Forgot Password flow

  const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  // Security: Invalidate all existing refresh tokens (sessions)
  await prisma.refreshToken.deleteMany({ where: { userId } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Resend OTP
// ─────────────────────────────────────────────────────────────────────────────
export const resendCode = async (dto: ForgotPasswordDto): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { email: dto.email } });
  if (!user) return;

  await prisma.otpCode.updateMany({
    where: { userId: user.id, used: false },
    data: { used: true },
  });

  const otp = generateOtp();

  await prisma.otpCode.create({
    data: {
      code: otp,
      purpose: dto.purpose,
      userId: user.id,
      expiresAt: otpExpiresAt(10),
    },
  });

  // Fix: fire-and-forget — new OTP is saved, don't crash if email provider is down
  sendOtpEmail(user.email, user.fullName, otp, dto.purpose).catch((err) => {});
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

  // Refresh token lives for 30 days
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
