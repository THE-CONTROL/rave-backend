-- AlterTable: headline overall-experience score, separate from the vendor and
-- rider scores. Nullable so existing reviews remain valid.
ALTER TABLE "reviews" ADD COLUMN "overallRating" INTEGER;
