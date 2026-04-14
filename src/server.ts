// src/server.ts
import app from "./app";
import { config } from "./config";
import { logger } from "./config/logger";
import { connectDatabase, disconnectDatabase } from "./config/database";
import { startJobs } from "./jobs";
import { seedPlatformConfig } from "./services/config.service";
import { seedOnboardingSlides } from "./services/onboarding.service";

const startServer = async () => {
  try {
    await connectDatabase();
    logger.info("✅ Database connected");

    // Seed admin-controlled data on first boot
    await seedPlatformConfig();
    await seedOnboardingSlides();
    logger.info("✅ Platform config and onboarding slides seeded");

    if (config.isProd) startJobs();

    const server = app.listen(config.port, () => {
      logger.info(
        `🚀 Rave API running in ${config.env} on http://localhost:${config.port}/api/${config.apiVersion}`,
      );
    });

    // ── Graceful shutdown ──────────────────────────────────────────────────
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received — shutting down gracefully`);
      server.close(async () => {
        await disconnectDatabase();
        logger.info("Server closed. Goodbye.");
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        logger.error("Forced shutdown after timeout");
        process.exit(1);
      }, 10_000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    process.on("unhandledRejection", (reason) => {
      logger.error("Unhandled Rejection:", reason);
    });

    process.on("uncaughtException", (err) => {
      logger.error("Uncaught Exception:", err);
      process.exit(1);
    });
  } catch (err) {
    logger.error("Failed to start server:", err);
    process.exit(1);
  }
};

startServer();
