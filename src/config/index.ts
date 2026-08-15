// src/config/index.ts
import dotenv from "dotenv";

dotenv.config();

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

const optional = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

const isProdEnv = optional("NODE_ENV", "development") === "production";
const port = parseInt(optional("PORT", "5000"), 10);

// Required in production; falls back to a local dev URL so `npm run dev`
// doesn't start crashing when APP_URL isn't set locally.
const resolveAppUrl = (): string => {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (isProdEnv) throw new Error("Missing required env var: APP_URL");
  return `http://localhost:${port}`;
};

// Same required-in-production/dev-fallback pattern — the scrypt salt used to
// derive the bank-account encryption key. A dev fallback keeps local `npm run
// dev` working without forcing every contributor to mint one; production must
// set a real, unguessable value.
const resolveEncryptionSalt = (): string => {
  if (process.env.ENCRYPTION_SALT) return process.env.ENCRYPTION_SALT;
  if (isProdEnv) throw new Error("Missing required env var: ENCRYPTION_SALT");
  return "dev-only-insecure-salt-do-not-use-in-prod";
};

export const config = {
  env: optional("NODE_ENV", "development"),
  port,
  apiVersion: optional("API_VERSION", "v1"),

  // Public base URL of this API (no trailing slash assumed by callers — see
  // usages). Used to build absolute callback URLs (e.g. Paystack's
  // callback_url) instead of hardcoding a dev tunnel hostname.
  appUrl: resolveAppUrl(),

  db: {
    url: required("DATABASE_URL"),
  },

  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET"),
    refreshSecret: required("JWT_REFRESH_SECRET"),
    accessExpiresIn: optional("JWT_ACCESS_EXPIRES_IN", "15m"),
    refreshExpiresIn: optional("JWT_REFRESH_EXPIRES_IN", "30d"),
  },

  // src/config/index.ts  — update the email section
  email: {
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    // ⚠ PLACEHOLDER default — not a real Rave domain. Set EMAIL_FROM once
    // the real sending domain/address is set up (needs SPF/DKIM configured
    // with Resend before it will deliver reliably) — see src/utils/email.ts.
    from: optional("EMAIL_FROM", "Rave <no-reply@rave.example.PLACEHOLDER>"),
  },

  cors: {
    allowedOrigins: optional(
      "ALLOWED_ORIGINS",
      "http://kz6eka6ebvyz61m64g34rtxv-180613240379:3000",
    )
      .split(",")
      .map((o) => o.trim()),
  },

  // First-admin bootstrap — only runs seedSuperAdmin() if both are set, so
  // absence is a no-op (never throws) rather than blocking every non-first boot.
  admin: {
    bootstrapEmail: process.env.BOOTSTRAP_ADMIN_EMAIL,
    bootstrapPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    bootstrapName: optional("BOOTSTRAP_ADMIN_NAME", "Super Admin"),
  },

  paystackSecretKey: required("PAYSTACK_SECRET_KEY"),

  encryption: {
    key: required("ENCRYPTION_KEY"),
    salt: resolveEncryptionSalt(),
  },

  isDev: optional("NODE_ENV", "development") === "development",
  isProd: isProdEnv,
} as const;
