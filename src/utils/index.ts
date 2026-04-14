// src/utils/index.ts
import { Response, Request, NextFunction, RequestHandler } from "express";
import { ApiResponse, PaginationMeta, PaginationQuery } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────────────────────────

export const ok = <T>(
  res: Response,
  data: T,
  message = "Success",
  meta?: PaginationMeta,
): Response =>
  res.status(200).json({
    success: true,
    message,
    data,
    ...(meta && { meta }),
  } satisfies ApiResponse<T>);

export const created = <T>(
  res: Response,
  data: T,
  message = "Created",
): Response =>
  res
    .status(201)
    .json({ success: true, message, data } satisfies ApiResponse<T>);

export const noContent = (res: Response): Response => res.status(204).send();

// ─────────────────────────────────────────────────────────────────────────────
// Async route wrapper — eliminates try/catch boilerplate
// ─────────────────────────────────────────────────────────────────────────────

export const asyncHandler =
  (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  ): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

// ─────────────────────────────────────────────────────────────────────────────
// Pagination helpers
// ─────────────────────────────────────────────────────────────────────────────

export const parsePagination = (query: PaginationQuery) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

export const buildMeta = (
  total: number,
  page: number,
  limit: number,
): PaginationMeta => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
});

// ─────────────────────────────────────────────────────────────────────────────
// OTP helpers
// ─────────────────────────────────────────────────────────────────────────────

export const generateOtp = (length = 6): string =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");

export const otpExpiresAt = (minutes = 10): Date => {
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes);
  return d;
};

// ─────────────────────────────────────────────────────────────────────────────
// Misc
// ─────────────────────────────────────────────────────────────────────────────

export const generateReferralCode = (): string =>
  Math.random().toString(36).substring(2, 10).toUpperCase();

export const generateOrderId = (): string =>
  "ORD-" + Date.now().toString(36).toUpperCase();

export const maskAccountNumber = (num: string): string =>
  num.slice(0, 3) + "****" + num.slice(-3);

/** Returns distance in kilometres between two lat/lng points */
export const haversineKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** Formats km distance to a human-readable label */
export const formatDistance = (km: number): string => {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
};

/** Rough ETA estimate: assumes 30km/h average speed in traffic */
export const estimateEtaMinutes = (km: number): number =>
  Math.max(10, Math.round((km / 30) * 60));
