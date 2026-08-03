/*
  Warnings:

  - Added the required column `estimatedArrival` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `etaDuration` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `evidenceUrl` to the `orders` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "estimatedArrival" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "etaDuration" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "evidenceUrl" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "promotions" ADD COLUMN     "appliesTo" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN     "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "minimumOrder" SET DEFAULT 0;
