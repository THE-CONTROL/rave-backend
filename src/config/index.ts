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

export const config = {
  env: optional("NODE_ENV", "development"),
  port: parseInt(optional("PORT", "5000"), 10),
  apiVersion: optional("API_VERSION", "v1"),

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
  },

  cors: {
    allowedOrigins: optional("ALLOWED_ORIGINS", "http://172.22.32.1:3000")
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

  isDev: optional("NODE_ENV", "development") === "development",
  isProd: optional("NODE_ENV", "development") === "production",
} as const;
