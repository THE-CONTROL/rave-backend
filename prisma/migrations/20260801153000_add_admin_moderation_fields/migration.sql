-- AlterTable: single-field admin response on support tickets (matches the
-- existing RefundRequest.updateMessage flat-field style, no message thread).
ALTER TABLE "reported_issues" ADD COLUMN "adminResponse" TEXT;
ALTER TABLE "reported_issues" ADD COLUMN "respondedAt" TIMESTAMP(3);
ALTER TABLE "reported_issues" ADD COLUMN "respondedBy" TEXT;

-- AlterTable: soft-hide flag for admin review moderation, so vendor rating
-- aggregates (averageRating/totalReviews/positiveReviews) can be recomputed
-- from live reviews without losing the original review data.
ALTER TABLE "reviews" ADD COLUMN "isRemoved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "reviews" ADD COLUMN "removedReason" TEXT;
