// src/routes/auth.routes.ts
import { Router } from "express";
import * as ctrl from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import * as v from "../validators";

const router = Router();

// Public
router.post("/signup",          validate(v.signUpSchema),         ctrl.signUp);
router.post("/signin",          validate(v.signInSchema),         ctrl.signIn);
router.post("/verify-email",    validate(v.verifyEmailSchema),    ctrl.verifyEmail);
router.post("/forgot-password", validate(v.forgotPasswordSchema), ctrl.forgotPassword);
router.post("/reset-password",  validate(v.resetPasswordSchema),  ctrl.resetPassword);
router.post("/resend-code",     validate(v.resendCodeSchema),     ctrl.resendCode);
router.post("/refresh",         validate(v.refreshTokenSchema),   ctrl.refreshTokens);

// Public — onboarding
router.get("/onboarding",  ctrl.getOnboardingSlides);

// Protected
router.post("/signout",    authenticate, ctrl.signOut);
router.patch("/push-token", authenticate, validate(v.pushTokenSchema), ctrl.updatePushToken);

export default router;
