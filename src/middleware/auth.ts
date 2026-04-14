// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import { Role } from "@prisma/client";
import { verifyAccessToken } from "../utils/jwt";
import { AppError } from "../utils/AppError";
import { AuthenticatedRequest } from "../types";
import { asyncHandler } from "../utils";

// ─────────────────────────────────────────────────────────────────────────────
// Authenticate — verifies the Bearer token and attaches req.user
// ─────────────────────────────────────────────────────────────────────────────

export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      throw AppError.unauthorized("No token provided.");
    }

    const token = authHeader.slice(7);
    const payload = verifyAccessToken(token);

    (req as AuthenticatedRequest).user = {
      id: payload.sub,
      role: payload.role,
      email: payload.email,
    };

    next();
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Authorize — restricts access to specific roles
// ─────────────────────────────────────────────────────────────────────────────

export const authorize =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;
    if (!user || !roles.includes(user.role)) {
      throw AppError.forbidden(
        "You do not have permission to perform this action.",
      );
    }
    next();
  };

// ─────────────────────────────────────────────────────────────────────────────
// Optional auth — attaches req.user if a valid token is present, but never
// throws if the token is missing or invalid. Used for public endpoints that
// show personalised data (e.g. isFavorite) when the user is logged in.
// ─────────────────────────────────────────────────────────────────────────────

export const optionalAuth = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = verifyAccessToken(token);
      (req as AuthenticatedRequest).user = {
        id: payload.sub,
        role: payload.role,
        email: payload.email,
      };
    }
  } catch {
    // Invalid token — just proceed as unauthenticated
  }
  next();
};
