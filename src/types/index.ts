// src/types/index.ts
import { Request } from "express";
import { Role } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Express augmentation
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    role: Role;
    email: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// API response shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

/**
 * Safely extracts pagination params from Express req.query.
 * Express types req.query values as string | ParsedQs | ... so we cast once here.
 */
export const extractPagination = (
  query: Record<string, unknown>,
): PaginationQuery => ({
  page: query.page ? Number(query.page) : undefined,
  limit: query.limit ? Number(query.limit) : undefined,
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth types
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenPayload {
  sub: string; // userId
  role: Role;
  email: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix seconds
}

export interface SignUpDto {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: Role;
}

export interface SignInDto {
  email: string;
  password: string;
}

export interface VerifyEmailDto {
  code: string;
  purpose: "verify-account" | "reset-password";
  role?: Role;
  email?: string;
}

export interface ForgotPasswordDto {
  email: string;
  purpose: string;
}

export interface ResetPasswordDto {
  password: string;
  confirmPassword: string;
}

export interface SignInResult {
  status: string;
  role: "user" | "vendor" | "rider"; // Added role
  tokens: TokenPair;
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CheckoutInput Type
 * Reflects the final refined requirements:
 * - Strictly uses savedLocationId (UUID)
 * - Restricts payment to card or bank_transfer (Paystack flow)
 * - Includes optional instructions and contact preferences
 */
export interface CheckoutInput {
  savedLocationId: string;
  paymentMethod: "card" | "bank_transfer";
  instructions?: string;
  contactMethod: "in-app" | "normal";
}

// Re-export notification payload types
export type {
  UserNotificationSettingsPayload,
  VendorNotificationSettingsPayload,
  NotificationSettingsPayload,
} from "./notifications";
