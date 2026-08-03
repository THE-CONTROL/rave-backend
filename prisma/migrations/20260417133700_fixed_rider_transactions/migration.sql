/*
  Warnings:

  - You are about to drop the `rider_bank_accounts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `rider_earnings_summary` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `rider_transactions` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[riderId,accountNumber]` on the table `bank_accounts` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "rider_bank_accounts" DROP CONSTRAINT "rider_bank_accounts_riderId_fkey";

-- DropForeignKey
ALTER TABLE "rider_transactions" DROP CONSTRAINT "rider_transactions_riderId_fkey";

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "riderId" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "riderId" TEXT;

-- DropTable
DROP TABLE "rider_bank_accounts";

-- DropTable
DROP TABLE "rider_earnings_summary";

-- DropTable
DROP TABLE "rider_transactions";

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_riderId_accountNumber_key" ON "bank_accounts"("riderId", "accountNumber");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "rider_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "rider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
