// src/app.ts
import express, { Request } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import { config } from "./config";
import { logger } from "./config/logger";
import routes from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

const app = express();

// Trust the first proxy hop (load balancer/reverse proxy) so req.ip reports
// the real client address rather than the proxy's — relied on by the global
// rate limiter and, now, admin audit-log IP capture.
app.set("trust proxy", 1);

// ─────────────────────────────────────────────────────────────────────────────
// Security
// ─────────────────────────────────────────────────────────────────────────────

app.use(helmet());

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || config.cors.allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error(`CORS blocked: ${origin}`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Global rate limiter
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: "Too many requests. Please try again in 15 minutes.",
    },
  }),
);

// A materially stricter, per-route limiter for the credential-guessing-prone
// auth endpoints (signin, verify-email, resend-code, forgot-password,
// reset-password) is applied directly in src/routes/auth.routes.ts — max: 200
// here was no stricter than the global limiter above and did nothing to slow
// down a brute-force/OTP-guessing attempt.

// ─────────────────────────────────────────────────────────────────────────────
// Body parsing & compression
// ─────────────────────────────────────────────────────────────────────────────

// Capture the raw request body alongside the parsed one — Paystack's webhook
// signature is computed over the exact bytes it sent, and re-serializing the
// already-parsed JSON (via JSON.stringify) isn't guaranteed byte-identical,
// which can cause legitimate webhooks to silently fail signature checks.
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(compression());

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

app.use(
  morgan(config.isDev ? "dev" : "combined", {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

app.use(`/api/${config.apiVersion}`, routes);

// ─────────────────────────────────────────────────────────────────────────────
// Error handling (must be last)
// ─────────────────────────────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
