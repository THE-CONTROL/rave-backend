// src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../utils/AppError";
import { logger } from "../config/logger";
import { config } from "../config";
import { ApiResponse } from "../types";

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  logger.error(err.message, { stack: err.stack });

  // ── Operational errors (expected) ────────────────────────────────────────
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    } satisfies ApiResponse);
    return;
  }

  // ── Zod validation errors ────────────────────────────────────────────────
  if (err instanceof ZodError) {
    res.status(422).json({
      success: false,
      message: "Validation failed",
      data: err.flatten().fieldErrors,
    } satisfies ApiResponse);
    return;
  }

  // ── Prisma unique constraint ──────────────────────────────────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const field = (err.meta?.target as string[])?.join(", ") ?? "field";
      res.status(409).json({
        success: false,
        message: `A record with this ${field} already exists.`,
      } satisfies ApiResponse);
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({
        success: false,
        message: "Record not found.",
      } satisfies ApiResponse);
      return;
    }
  }

  // ── JWT errors ───────────────────────────────────────────────────────────
  if (err.name === "JsonWebTokenError") {
    res.status(401).json({ success: false, message: "Invalid token." } satisfies ApiResponse);
    return;
  }
  if (err.name === "TokenExpiredError") {
    res.status(401).json({ success: false, message: "Token expired." } satisfies ApiResponse);
    return;
  }

  // ── Unknown / programming errors ─────────────────────────────────────────
  res.status(500).json({
    success: false,
    message: config.isDev ? err.message : "Something went wrong.",
  } satisfies ApiResponse);
};

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    message: "Route not found.",
  } satisfies ApiResponse);
};
