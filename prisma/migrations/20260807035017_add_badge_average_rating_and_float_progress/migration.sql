-- AlterEnum
ALTER TYPE "BadgeMetric" ADD VALUE 'average_rating';

-- AlterTable
ALTER TABLE "badge_requirements" ALTER COLUMN "total" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "vendor_badges" ALTER COLUMN "current" SET DEFAULT 0,
ALTER COLUMN "current" SET DATA TYPE DOUBLE PRECISION;
