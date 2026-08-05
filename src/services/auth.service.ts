// src/services/auth.service.ts
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { generateOtp, generateReferralCode, otpExpiresAt } from "../utils";
import { issueTokenPair, verifyRefreshToken } from "../utils/jwt";
import { sendOtpEmail, sendWelcomeEmail } from "../utils/email";
import { cfg } from "./config.service";
import { seedVendorBadges } from "./badgeEvaluation.service";
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

// A valid bcrypt hash of an unguessable, never-used password. Compared against
// on every failed-lookup sign-in attempt so that "no such user" and "wrong
// password" take the same amount of time — otherwise the missing bcrypt.compare
// call for a nonexistent email would make account existence timing-detectable.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  "dummy-password-for-constant-time-compare",
  SALT_ROUNDS,
);

// ─────────────────────────────────────────────────────────────────────────────
// Sign Up
// ─────────────────────────────────────────────────────────────────────────────
export const signUp = async (dto: SignUpDto): Promise<void> => {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: dto.email }, { phone: dto.phoneNumber }] },
  });

  if (existing) {
    // Deliberately generic — naming which field (email vs phone) collided
    // would let the public signup endpoint be used to enumerate registered
    // accounts.
    throw AppError.conflict("An account with these details already exists.");
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

  const otp = generateOtp(await cfg.otp.length());

  let newVendorProfileId: string | undefined;

  const profileCreate =
    dto.role === "vendor"
      ? prisma.vendorProfile
          .create({ data: { userId: user.id, storeName: dto.name + "'s Store" } })
          .then((vp) => {
            newVendorProfileId = vp.id;
          })
      : dto.role === "rider"
        ? prisma.riderProfile.create({ data: { userId: user.id } })
        : Promise.resolve();

  const otpCreate = prisma.otpCode.create({
    data: {
      code: otp,
      purpose: "verify-account",
      userId: user.id,
      expiresAt: otpExpiresAt(await cfg.otp.expiryMinutes()),
    },
  });

  await Promise.all([profileCreate, otpCreate]);

  // Gives a new vendor visibility into every badge (locked/in_progress) from
  // day one, instead of an empty list forever — see badgeEvaluation.service.
  if (newVendorProfileId) await seedVendorBadges(newVendorProfileId);

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
  sendOtpEmail(user.email, user.fullName, otp, "verify-account").catch(
    (err) => {},
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Verify Email (OTP)
// ─────────────────────────────────────────────────────────────────────────────

export const verifyEmail = async (
  dto: VerifyEmailDto,
): Promise<{ purpose: string; tokens?: TokenPair; role: Role }> => {
  // Look up by user+purpose only (not code) so a wrong guess can be counted
  // against this specific pending OTP rather than silently matching nothing.
  const otpRecord = await prisma.otpCode.findFirst({
    where: {
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

  if (otpRecord.attempts >= (await cfg.otp.maxAttempts())) {
    throw AppError.badRequest(
      "Too many incorrect attempts. Please request a new code.",
    );
  }

  if (otpRecord.code !== dto.code) {
    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { attempts: { increment: 1 } },
    });
    throw AppError.badRequest("Invalid or expired OTP code.");
  }

  if (dto.purpose === "verify-account") {
    // Mark OTP used + verify user email concurrently — neither depends on the other
    const markUsed = prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { used: true },
    });
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

  // reset-password: deliberately leave the OTP unused here — it's re-validated
  // and only consumed once the password is actually changed in resetPassword()
  // below, so verifying the code alone can never be used to reset a password.
  return { purpose: "reset-password", role: otpRecord.user.role };
};

// ─────────────────────────────────────────────────────────────────────────────
// Sign In
// ─────────────────────────────────────────────────────────────────────────────

// Which account roles are allowed to sign in through each client app.
const AUDIENCE_ROLES: Record<string, Role[]> = {
  rave: ["user", "vendor"],
  ridewithrave: ["rider"],
  "rave-admin": ["admin"],
};

export const signIn = async (dto: SignInDto): Promise<SignInResult> => {
  const user = await prisma.user.findUnique({ where: { email: dto.email } });

  // Always run bcrypt.compare, even when no user was found, against a dummy
  // hash — keeps response time constant so timing can't reveal whether an
  // email is registered.
  const passwordMatches = await bcrypt.compare(
    dto.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !passwordMatches) {
    throw AppError.unauthorized("Invalid email or password.");
  }

  if (!user.isEmailVerified) {
    throw AppError.unauthorized("Please verify your email before signing in.");
  }

  if (!user.isActive) {
    throw AppError.forbidden("Your account has been deactivated.");
  }

  if (!AUDIENCE_ROLES[dto.audience]?.includes(user.role)) {
    throw AppError.forbidden(
      "This account isn't set up for this app. Please use the correct Rave app to sign in.",
    );
  }

  if (user.role === "admin") {
    const profile = await prisma.adminProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile?.isActive) {
      throw AppError.forbidden("Your admin account has been deactivated.");
    }
    await prisma.adminProfile.update({
      where: { userId: user.id },
      data: { lastLoginAt: new Date() },
    });
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

  if (!user.isActive) {
    throw AppError.forbidden("Your account has been deactivated.");
  }

  return _createSession(user.id, user.role, user.email);
};

// ─────────────────────────────────────────────────────────────────────────────
// Forgot Password
// ─────────────────────────────────────────────────────────────────────────────
export const forgotPassword = async (dto: ForgotPasswordDto): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { email: dto.email } });
  if (!user) return;

  const otp = generateOtp(await cfg.otp.length());
  await prisma.otpCode.create({
    data: {
      code: otp,
      purpose: dto.purpose,
      userId: user.id,
      expiresAt: otpExpiresAt(await cfg.otp.expiryMinutes()),
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

  // Require the same OTP the user just verified — this is the only proof that
  // whoever is calling this endpoint actually received the reset code by email.
  const otpRecord = await prisma.otpCode.findFirst({
    where: {
      userId,
      code: dto.code,
      purpose: "reset-password",
      used: false,
    },
  });

  if (!otpRecord || otpRecord.expiresAt < new Date()) {
    throw AppError.badRequest("Invalid or expired code.");
  }

  const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    }),
    prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { used: true },
    }),
  ]);

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
    where: { userId: user.id, used: false, purpose: dto.purpose },
    data: { used: true },
  });

  const otp = generateOtp(await cfg.otp.length());

  await prisma.otpCode.create({
    data: {
      code: otp,
      purpose: dto.purpose,
      userId: user.id,
      expiresAt: otpExpiresAt(await cfg.otp.expiryMinutes()),
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
