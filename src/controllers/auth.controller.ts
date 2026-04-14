// src/controllers/auth.controller.ts
import { Request, Response } from "express";
import * as authService from "../services/auth.service";
import { getSlides } from "../services/onboarding.service";
import { Role } from "@prisma/client";
import { AuthenticatedRequest } from "../types";
import { ok, created, asyncHandler } from "../utils";

export const signUp = asyncHandler(async (req: Request, res: Response) => {
  await authService.signUp(req.body);
  res.status(201).json({
    success: true,
    message:
      "Account created. Please check your email for a verification code.",
  });
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.verifyEmail(req.body);
  ok(res, result, "Email verified successfully.");
});

export const signIn = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.signIn(req.body);
  ok(res, result, "Signed in successfully.");
});

export const refreshTokens = asyncHandler(
  async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    const tokens = await authService.refreshTokens(refreshToken);
    ok(res, tokens, "Tokens refreshed.");
  },
);

export const forgotPassword = asyncHandler(
  async (req: Request, res: Response) => {
    await authService.forgotPassword(req.body);
    ok(
      res,
      null,
      "If this email is registered, you will receive a reset code shortly.",
    );
  },
);

export const resetPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).user?.id ?? req.body.userId;
    await authService.resetPassword(userId, req.body);
    ok(res, null, "Password updated successfully.");
  },
);

export const resendCode = asyncHandler(async (req: Request, res: Response) => {
  await authService.resendCode(req.body);
  ok(res, null, "A new code has been sent to your email.");
});

export const signOut = asyncHandler(async (req: Request, res: Response) => {
  const { id } = (req as AuthenticatedRequest).user;
  await authService.signOut(id, req.body.refreshToken);
  ok(res, null, "Signed out successfully.");
});

export const getOnboardingSlides = asyncHandler(
  async (req: Request, res: Response) => {
    const role = (req.query.role as Role) ?? "user";
    ok(res, getSlides(role));
  },
);

export const updatePushToken = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = (req as AuthenticatedRequest).user;
    await authService.updatePushToken(id, req.body.token);
    ok(res, null, "Push token updated.");
  },
);
