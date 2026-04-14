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
    accessSecret: optional("JWT_ACCESS_SECRET", "dev_access_secret_change_me"),
    refreshSecret: optional(
      "JWT_REFRESH_SECRET",
      "dev_refresh_secret_change_me",
    ),
    accessExpiresIn: optional("JWT_ACCESS_EXPIRES_IN", "15m"),
    refreshExpiresIn: optional("JWT_REFRESH_EXPIRES_IN", "30d"),
  },

  email: {
    host: optional("SMTP_HOST", "smtp.gmail.com"),
    port: parseInt(optional("SMTP_PORT", "587"), 10),
    user: optional("SMTP_USER", ""),
    pass: optional("SMTP_PASS", ""),
    from: optional("EMAIL_FROM", "Rave App <noreply@rave.com>"),
  },

  upload: {
    dir: optional("UPLOAD_DIR", "uploads"),
    maxSizeMb: parseInt(optional("MAX_FILE_SIZE_MB", "10"), 10),
  },

  cors: {
    allowedOrigins: optional("ALLOWED_ORIGINS", "http://localhost:3000")
      .split(",")
      .map((o) => o.trim()),
  },

  isDev: optional("NODE_ENV", "development") === "development",
  isProd: optional("NODE_ENV", "development") === "production",
} as const;
