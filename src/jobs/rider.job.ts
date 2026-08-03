// src/jobs/rider.job.ts
import { prisma } from "../config/database";
import { logger } from "../config/logger";

const LOCATION_LOG_RETENTION_DAYS = 7;

/**
 * rider_location_logs is written on every location ping (~every 10s per
 * active rider) with no other retention mechanism — "current" location
 * lives on RiderProfile.currentLat/currentLng, and admin only ever reads an
 * aggregate count over this table, never the raw rows. Left unpruned it
 * grows unbounded, so purge anything older than the retention window.
 */
export const cleanupOldRiderLocationLogs = async (): Promise<void> => {
  const cutoff = new Date(
    Date.now() - LOCATION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const { count } = await prisma.riderLocationLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  if (count > 0) {
    logger.info(`[job:riderLocationLogs] Purged ${count} location log rows older than ${LOCATION_LOG_RETENTION_DAYS}d`);
  }
};
