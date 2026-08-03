/*
  Warnings:

  - The values [wallet,ussd] on the enum `PaymentMethod` will be removed. If these variants are still used in the database, this will fail.
  - The values [successful,pending,failed] on the enum `TransactionStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [top_up,order_payment,referral_bonus,withdrawal,payout] on the enum `TransactionType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `isDefault` on the `bank_accounts` table. All the data in the column will be lost.
  - You are about to drop the column `balanceAfter` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `previousBalance` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the `vendor_bank_accounts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `vendor_transactions` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[userId,accountNumber]` on the table `bank_accounts` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[vendorId,accountNumber]` on the table `bank_accounts` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `bank_accounts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PaymentMethod_new" AS ENUM ('card', 'bank_transfer');
ALTER TABLE "orders" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod_new" USING ("paymentMethod"::text::"PaymentMethod_new");
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";
DROP TYPE "PaymentMethod_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "TransactionStatus_new" AS ENUM ('initiated', 'completed');
ALTER TABLE "transactions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "transactions" ALTER COLUMN "status" TYPE "TransactionStatus_new" USING ("status"::text::"TransactionStatus_new");
ALTER TYPE "TransactionStatus" RENAME TO "TransactionStatus_old";
ALTER TYPE "TransactionStatus_new" RENAME TO "TransactionStatus";
DROP TYPE "TransactionStatus_old";
ALTER TABLE "transactions" ALTER COLUMN "status" SET DEFAULT 'initiated';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "TransactionType_new" AS ENUM ('payment', 'order', 'refund', 'referral');
ALTER TABLE "transactions" ALTER COLUMN "type" TYPE "TransactionType_new" USING ("type"::text::"TransactionType_new");
ALTER TYPE "TransactionType" RENAME TO "TransactionType_old";
ALTER TYPE "TransactionType_new" RENAME TO "TransactionType";
DROP TYPE "TransactionType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_userId_fkey";

-- DropForeignKey
ALTER TABLE "vendor_bank_accounts" DROP CONSTRAINT "vendor_bank_accounts_vendorId_fkey";

-- DropForeignKey
ALTER TABLE "vendor_transactions" DROP CONSTRAINT "vendor_transactions_vendorId_fkey";

-- AlterTable
ALTER TABLE "bank_accounts" DROP COLUMN "isDefault",
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "vendorId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "discountAmount" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "balanceAfter",
DROP COLUMN "previousBalance",
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "fee" DOUBLE PRECISION,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "subtotal" DOUBLE PRECISION,
ADD COLUMN     "vendorId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'initiated',
ALTER COLUMN "paymentMethod" SET DEFAULT 'Card';

-- DropTable
DROP TABLE "vendor_bank_accounts";

-- DropTable
DROP TABLE "vendor_transactions";

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_userId_accountNumber_key" ON "bank_accounts"("userId", "accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_vendorId_accountNumber_key" ON "bank_accounts"("vendorId", "accountNumber");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
