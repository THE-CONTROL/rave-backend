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
      wallet: { create: {} },
      notificationSettings: { create: {} },
    },
  });

  // Create role-specific profile stubs
  if (dto.role === "vendor") {
    await prisma.vendorProfile.create({
      data: {
        userId: user.id,
        storeName: dto.name + "'s Store",
      },
    });
  }

  if (dto.role === "rider") {
    const riderProfile = await prisma.riderProfile.create({
      data: { userId: user.id },
    });
    await prisma.riderEarningsSummary.create({
      data: {
        riderId: riderProfile.id,
        availableBalance: 0,
        pendingBalance: 0,
      },
    });
  }

  const otp = generateOtp();
  await prisma.otpCode.create({
    data: {
      code: otp,
      purpose: "verify-account",
      userId: user.id,
      expiresAt: otpExpiresAt(10),
    },
  });

  await sendOtpEmail(user.email, user.fullName, otp, "verify-account");
};

// ─────────────────────────────────────────────────────────────────────────────
// Verify Email (OTP)
// ─────────────────────────────────────────────────────────────────────────────

export const verifyEmail = async (
  dto: VerifyEmailDto,
): Promise<{ purpose: string; tokens?: TokenPair }> => {
  // Find the most recent unused OTP for this purpose
  const otpRecord = await prisma.otpCode.findFirst({
    where: { code: dto.code, purpose: dto.purpose, used: false },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });

  if (!otpRecord || otpRecord.expiresAt < new Date()) {
    throw AppError.badRequest("Invalid or expired OTP code.");
  }

  // Mark OTP as used
  await prisma.otpCode.update({
    where: { id: otpRecord.id },
    data: { used: true },
  });

  if (dto.purpose === "verify-account") {
    await prisma.user.update({
      where: { id: otpRecord.userId },
      data: { isEmailVerified: true },
    });

    const tokens = await _createSession(
      otpRecord.user.id,
      otpRecord.user.role,
      otpRecord.user.email,
    );

    await sendWelcomeEmail(otpRecord.user.email, otpRecord.user.fullName);

    return { purpose: "verify-account", tokens };
  }

  return { purpose: "reset-password" };
};

// ─────────────────────────────────────────────────────────────────────────────
// Sign In
// ─────────────────────────────────────────────────────────────────────────────

export const signIn = async (
  dto: SignInDto,
): Promise<{ status: string; tokens: TokenPair }> => {
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
  return { status: "complete", tokens };
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
  // Always respond with the same message to avoid email enumeration
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

  await sendOtpEmail(user.email, user.fullName, otp, "reset-password");
};

// ─────────────────────────────────────────────────────────────────────────────
// Reset Password
// ─────────────────────────────────────────────────────────────────────────────

export const resetPassword = async (
  userId: string,
  dto: ResetPasswordDto,
): Promise<void> => {
  // 1. Find the user to get the current hash
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw AppError.unauthorized("User not found.");
  }

  // 2. Verify current password
  const isMatch = await bcrypt.compare(dto.password, user.passwordHash);

  if (!isMatch) {
    throw AppError.badRequest("The current password provided is incorrect.");
  }

  const newPasswordsMatch = dto.password === dto.confirmPassword;
  if (!newPasswordsMatch) {
    throw AppError.badRequest("The passwords do not match.");
  }

  // 3. Hash the NEW password
  const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

  // 4. Update user and invalidate sessions
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  await prisma.refreshToken.deleteMany({ where: { userId } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Resend OTP
// ─────────────────────────────────────────────────────────────────────────────

export const resendCode = async (dto: ForgotPasswordDto): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { email: dto.email } });
  if (!user) return;

  // Invalidate old codes
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

  await sendOtpEmail(user.email, user.fullName, otp, dto.purpose);
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
    // Revoke all sessions
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

  const expiresAt = new Date(tokenPair.expiresAt * 1000);
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
