-- CreateEnum
CREATE TYPE "BadgeMetric" AS ENUM ('total_orders', 'total_revenue', 'total_reviews');

-- AlterTable
ALTER TABLE "badge_requirements" ADD COLUMN     "metric" "BadgeMetric" NOT NULL DEFAULT 'total_orders';
