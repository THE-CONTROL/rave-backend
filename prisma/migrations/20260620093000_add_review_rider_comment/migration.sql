-- AlterTable: rider-only review note, shown only in the rider's feed so it's
-- separate from the vendor/food-facing comment.
ALTER TABLE "reviews" ADD COLUMN "riderComment" TEXT;
