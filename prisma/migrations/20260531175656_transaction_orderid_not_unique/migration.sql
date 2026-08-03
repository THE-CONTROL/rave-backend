/*
  Warnings:

  - You are about to drop the `_OrderToTransaction` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_OrderToTransaction" DROP CONSTRAINT "_OrderToTransaction_A_fkey";

-- DropForeignKey
ALTER TABLE "_OrderToTransaction" DROP CONSTRAINT "_OrderToTransaction_B_fkey";

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "orderId" TEXT;

-- DropTable
DROP TABLE "_OrderToTransaction";

-- CreateIndex
CREATE INDEX "transactions_orderId_idx" ON "transactions"("orderId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
