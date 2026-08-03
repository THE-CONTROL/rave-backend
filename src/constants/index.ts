// src/constants/index.ts

// ─────────────────────────────────────────────────────────────────────────────
// Fees, referral bonuses, OTP settings, and the order-cancel window all live
// in PlatformConfig (see src/services/config.service.ts's `cfg` object) so
// admins can edit them without a deployment — no code constants for those here.
// ─────────────────────────────────────────────────────────────────────────────

export const ORDER = {
  CANCELLABLE_STATUSES: ["new", "accepted"] as const,
  REVIEWABLE_STATUSES: ["completed"] as const,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Pagination defaults
// ─────────────────────────────────────────────────────────────────────────────

export const PAGINATION = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Order status transition rules
// Each status maps to the set of statuses it can transition TO
// ─────────────────────────────────────────────────────────────────────────────

export const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  new: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready"],
  ready: ["ongoing", "cancelled"],
  ongoing: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Token TTLs (in seconds, for reference — actual values set via JWT options)
// ─────────────────────────────────────────────────────────────────────────────

export const TOKEN_TTL = {
  ACCESS: 15 * 60, // 15 minutes
  REFRESH: 30 * 24 * 60 * 60, // 30 days
} as const;
