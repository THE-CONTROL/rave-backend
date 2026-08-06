/**
 * src/services/config.service.ts
 *
 * All platform constants (fees, limits, referral bonuses, etc.) are stored
 * in the platform_config table so admins can update them without a deployment.
 *
 * Each key has a hardcoded default that is used:
 *  1. On first boot before the DB has been seeded.
 *  2. As a safety net if the DB value is malformed.
 */

import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";

// ─────────────────────────────────────────────────────────────────────────────
// Defaults (used only when DB row is missing)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS: Record<string, string> = {
  // Fees
  "fees.delivery_base": "800",
  "fees.service_fee": "150",
  "fees.vat_rate": "0.075",
  "fees.vendor_commission": "0.10",
  "fees.rider_share": "0.70", // rider gets 70% of delivery fee

  // Orders
  "orders.cancel_window_secs": "300", // 5 minutes
  "orders.max_cart_vendors": "1",
  "orders.rider_radius_km": "10", // rider must be within this of both vendor and customer to see an order

  // Catalog
  "catalog.vendor_radius_km": "10", // vendor must be within this of a customer to appear in "nearby"

  // Referral
  "referral.referee_bonus": "1000",
  "referral.referrer_bonus": "1000",
  "referral.min_order_amount": "3000",

  // OTP
  "otp.length": "6",
  "otp.expiry_minutes": "10",
  "otp.max_attempts": "5",
};

// ─────────────────────────────────────────────────────────────────────────────
// Cache — avoid a DB round-trip on every request
// ─────────────────────────────────────────────────────────────────────────────

let _cache: Record<string, string> | null = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 60_000; // refresh every 60 seconds

const loadAll = async (): Promise<Record<string, string>> => {
  const now = Date.now();
  if (_cache && now - _cachedAt < CACHE_TTL_MS) return _cache;

  const rows = await prisma.platformConfig.findMany();
  const map: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) {
    map[row.key] = row.value;
  }
  _cache = map;
  _cachedAt = now;
  return map;
};

/** Bust cache — call after admin updates a config value */
export const bustConfigCache = () => {
  _cache = null;
  _cachedAt = 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Typed getters
// ─────────────────────────────────────────────────────────────────────────────

const num = async (key: string): Promise<number> => {
  const map = await loadAll();
  const val = parseFloat(map[key] ?? DEFAULTS[key] ?? "0");
  return isNaN(val) ? parseFloat(DEFAULTS[key] ?? "0") : val;
};

const int = async (key: string): Promise<number> => {
  const val = await num(key);
  return Math.round(val);
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API — mirrors old FEES / REFERRAL / ORDER constants
// ─────────────────────────────────────────────────────────────────────────────

export const cfg = {
  fees: {
    deliveryBase: () => num("fees.delivery_base"),
    serviceFee: () => num("fees.service_fee"),
    vatRate: () => num("fees.vat_rate"),
    vendorCommission: () => num("fees.vendor_commission"),
  },
  orders: {
    cancelWindowSecs: () => int("orders.cancel_window_secs"),
    riderRadiusKm: () => num("orders.rider_radius_km"),
  },
  catalog: {
    vendorRadiusKm: () => num("catalog.vendor_radius_km"),
  },
  referral: {
    refereeBonus: () => num("referral.referee_bonus"),
    referrerBonus: () => num("referral.referrer_bonus"),
    minOrderAmount: () => num("referral.min_order_amount"),
  },
  otp: {
    length: () => int("otp.length"),
    expiryMinutes: () => int("otp.expiry_minutes"),
    maxAttempts: () => int("otp.max_attempts"),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Seed — insert defaults if missing (call on app startup)
// ─────────────────────────────────────────────────────────────────────────────

export const seedPlatformConfig = async (): Promise<void> => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await prisma.platformConfig.upsert({
      where: { key },
      create: { key, value, group: key.split(".")[0] },
      update: {}, // never overwrite existing admin values
    });
  }
};

export const seedAds = async (): Promise<void> => {
  // ── Sample advertisement ────────────────────────────────────────────────────
  await prisma.advertisement.upsert({
    where: { id: "ad-user-001" },
    update: {},
    create: {
      id: "ad-user-001",
      type: "image",
      contentUri:
        "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600",
      headline: "50% Off Your First Order!",
      bodyText: "Use code WELCOME50 at checkout.",
      ctaText: "Order Now",
      targetRole: "user",
      isActive: true,
    },
  });

  await prisma.advertisement.upsert({
    where: { id: "ad-vendor-001" },
    update: {},
    create: {
      id: "ad-vendor-001",
      type: "image",
      contentUri:
        "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600",
      headline: "Boost Your Sales",
      bodyText: "Upgrade to Pro and get featured on the home page.",
      ctaText: "Upgrade Now",
      targetRole: "vendor",
      isActive: true,
    },
  });

  await prisma.advertisement.upsert({
    where: { id: "ad-rider-001" },
    update: {},
    create: {
      id: "ad-rider-001",
      type: "image",
      contentUri:
        "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600",
      headline: "Boost Your Sales",
      bodyText: "Upgrade to Pro and get featured on the home page.",
      ctaText: "Upgrade Now",
      targetRole: "rider",
      isActive: true,
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Admin CRUD
// ─────────────────────────────────────────────────────────────────────────────

export const getAllConfigs = async () => {
  const configs = await prisma.platformConfig.findMany({
    orderBy: [{ group: "asc" }, { key: "asc" }],
  });

  const updaterIds = configs.map((c) => c.updatedBy).filter((id): id is string => !!id);
  const updaters = await prisma.user.findMany({
    where: { id: { in: updaterIds } },
    select: { id: true, fullName: true },
  });
  const byId = new Map(updaters.map((u) => [u.id, u]));

  return configs.map((c) => ({
    ...c,
    updatedByName: c.updatedBy ? (byId.get(c.updatedBy)?.fullName ?? null) : null,
  }));
};

export const updateConfig = async (
  key: string,
  value: string,
  adminId?: string,
): Promise<void> => {
  if (isNaN(parseFloat(value)))
    throw AppError.badRequest(`Config value for "${key}" must be a number.`);

  await prisma.platformConfig.upsert({
    where: { key },
    create: { key, value, group: key.split(".")[0], updatedBy: adminId },
    update: { value, updatedBy: adminId },
  });

  bustConfigCache();
};
