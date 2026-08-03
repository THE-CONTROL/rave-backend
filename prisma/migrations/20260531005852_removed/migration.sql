/*
  Warnings:

  - You are about to drop the column `orderId` on the `transactions` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_orderId_fkey";

-- DropIndex
DROP INDEX "transactions_orderId_key";

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "orderId";

-- CreateTable
CREATE TABLE "_OrderToTransaction" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_OrderToTransaction_AB_unique" ON "_OrderToTransaction"("A", "B");

-- CreateIndex
CREATE INDEX "_OrderToTransaction_B_index" ON "_OrderToTransaction"("B");

-- AddForeignKey
ALTER TABLE "_OrderToTransaction" ADD CONSTRAINT "_OrderToTransaction_A_fkey" FOREIGN KEY ("A") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OrderToTransaction" ADD CONSTRAINT "_OrderToTransaction_B_fkey" FOREIGN KEY ("B") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
