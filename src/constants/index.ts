// src/constants/index.ts

// ─────────────────────────────────────────────────────────────────────────────
// Fees & financial
// ─────────────────────────────────────────────────────────────────────────────

export const FEES = {
  DELIVERY_BASE: 800, // ₦800 base delivery fee
  SERVICE_FEE: 150, // ₦150 per order service fee
  VAT_RATE: 0.075, // 7.5% VAT
  VENDOR_COMMISSION: 0.1, // 10% platform commission on vendor earnings
  MIN_WITHDRAWAL: 1000, // ₦1,000 minimum user wallet withdrawal
  MIN_VENDOR_PAYOUT: 1000, // ₦1,000 minimum vendor payout
  MIN_TOPUP: 100, // ₦100 minimum wallet top-up
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Referral
// ─────────────────────────────────────────────────────────────────────────────

export const REFERRAL = {
  REFEREE_BONUS: 1000, // ₦1,000 off first order for referee
  REFERRER_BONUS: 1000, // ₦1,000 for referrer when referee completes ₦3,000+ order
  MIN_ORDER_FOR_BONUS: 3000,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// OTP
// ─────────────────────────────────────────────────────────────────────────────

export const OTP = {
  LENGTH: 6,
  EXPIRY_MINUTES: 10,
  MAX_ATTEMPTS: 5,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Order cancellation window
// ─────────────────────────────────────────────────────────────────────────────

export const ORDER = {
  CANCEL_WINDOW_SECONDS: 300, // 5 minutes after placement
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
// Upload limits
// ─────────────────────────────────────────────────────────────────────────────

export const UPLOAD = {
  MAX_ATTACHMENTS: 5,
  ALLOWED_MIME_TYPES: ["image/jpeg", "image/png", "image/webp", "video/mp4"],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Token TTLs (in seconds, for reference — actual values set via JWT options)
// ─────────────────────────────────────────────────────────────────────────────

export const TOKEN_TTL = {
  ACCESS: 15 * 60, // 15 minutes
  REFRESH: 30 * 24 * 60 * 60, // 30 days
} as const;
