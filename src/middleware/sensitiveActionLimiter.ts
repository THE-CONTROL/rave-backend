// src/middleware/sensitiveActionLimiter.ts
import rateLimit from "express-rate-limit";

/**
 * Stricter limiter for high-impact admin write actions (suspend/deny a
 * vendor or rider, force-approve/decline a refund, suspend/delete a user,
 * change platform config). These share the same 200-req/15-min budget as
 * all other API traffic by default — this caps them tighter so a compromised
 * admin session or a scripting mistake can't rapid-fire destructive actions.
 */
export const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many sensitive actions performed. Please try again in 15 minutes.",
  },
});
