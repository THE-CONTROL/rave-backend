/*
  Warnings:

  - You are about to drop the column `cacUrl` on the `vendor_profiles` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "vendor_profiles" DROP COLUMN "cacUrl",
ADD COLUMN     "storeDoc" TEXT,
ADD COLUMN     "storeDocType" TEXT;
