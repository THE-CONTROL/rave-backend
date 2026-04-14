// src/app.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";

import { config } from "./config";
import { logger } from "./config/logger";
import routes from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

const app = express();

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
    message: { success: false, message: "Too many requests. Please try again later." },
  }),
);

// Stricter limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many auth attempts. Please try again later." },
});

// ─────────────────────────────────────────────────────────────────────────────
// Body parsing & compression
// ─────────────────────────────────────────────────────────────────────────────

app.use(express.json({ limit: "10mb" }));
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
// Static uploads
// ─────────────────────────────────────────────────────────────────────────────

const uploadDir = path.resolve(config.upload.dir);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use("/uploads", express.static(uploadDir));

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

app.use(`/api/${config.apiVersion}/auth`, authLimiter);
app.use(`/api/${config.apiVersion}`, routes);

// ─────────────────────────────────────────────────────────────────────────────
// Error handling (must be last)
// ─────────────────────────────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
