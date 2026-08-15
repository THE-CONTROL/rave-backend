// src/routes/auth.routes.ts
import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as ctrl from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import * as v from "../validators";

const router = Router();

// Materially stricter than the app-wide global limiter (max: 200 /
// 15min) — these five routes are exactly the ones a credential-stuffing or
// OTP-guessing attempt would hammer (password checks, OTP verification,
// resend, reset). This also covers the admin dashboard's login, which
// proxies to this same /auth/signin endpoint.
const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts. Please try again in 15 minutes.",
  },
});

// Public
router.post(
  "/signup",
  strictAuthLimiter,
  validate(v.signUpSchema),
  ctrl.signUp,
);
router.post(
  "/signin",
  strictAuthLimiter,
  validate(v.signInSchema),
  ctrl.signIn,
);
router.post(
  "/verify-email",
  strictAuthLimiter,
  validate(v.verifyEmailSchema),
  ctrl.verifyEmail,
);
router.post(
  "/forgot-password",
  strictAuthLimiter,
  validate(v.forgotPasswordSchema),
  ctrl.forgotPassword,
);
router.post(
  "/reset-password",
  strictAuthLimiter,
  validate(v.resetPasswordSchema),
  ctrl.resetPassword,
);
router.post(
  "/resend-code",
  strictAuthLimiter,
  validate(v.resendCodeSchema),
  ctrl.resendCode,
);
router.post("/refresh", validate(v.refreshTokenSchema), ctrl.refreshTokens);

// Public — onboarding
router.get("/onboarding", ctrl.getOnboardingSlides);

// Protected
router.post("/signout", authenticate, ctrl.signOut);
router.patch(
  "/push-token",
  authenticate,
  validate(v.pushTokenSchema),
  ctrl.updatePushToken,
);

export default router;
