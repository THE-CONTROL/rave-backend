/*
  Warnings:

  - Added the required column `afterBalance` to the `vendor_transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `prevBalance` to the `vendor_transactions` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "vendor_transactions" DROP CONSTRAINT "vendor_transactions_vendorId_fkey";

-- AlterTable
ALTER TABLE "badges" ADD COLUMN     "perks" TEXT[];

-- AlterTable
ALTER TABLE "vendor_transactions" ADD COLUMN     "afterBalance" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "fee" DOUBLE PRECISION,
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "paymentMethod" TEXT NOT NULL DEFAULT 'Card',
ADD COLUMN     "prevBalance" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "subtotal" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "vendor_transactions" ADD CONSTRAINT "vendor_transactions_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
