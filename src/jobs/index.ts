// src/jobs/index.ts
/**
 * Lightweight periodic jobs using setInterval.
 * In production, replace with a proper queue (BullMQ + Redis).
 */

import { logger } from "../config/logger";
import { processReferralBonuses } from "./referral.job";
import { cleanupStaleOrders } from "./order.job";
import { cleanupOldRiderLocationLogs } from "./rider.job";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const startJobs = (): void => {
  // Referral bonus: check every 5 minutes
  setInterval(async () => {
    try {
      await processReferralBonuses();
    } catch (err) {
      logger.error("[job:referral] failed", err);
    }
  }, 5 * MINUTE);

  // Stale order cleanup: every 10 minutes
  setInterval(async () => {
    try {
      await cleanupStaleOrders();
    } catch (err) {
      logger.error("[job:staleOrders] failed", err);
    }
  }, 10 * MINUTE);

  // Rider location log retention: once a day
  setInterval(async () => {
    try {
      await cleanupOldRiderLocationLogs();
    } catch (err) {
      logger.error("[job:riderLocationLogs] failed", err);
    }
  }, 24 * HOUR);

  logger.info("⏱  Background jobs started");
};
