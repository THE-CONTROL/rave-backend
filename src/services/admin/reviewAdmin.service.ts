// src/services/admin/reviewAdmin.service.ts
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";

export interface ListReviewReportsQuery extends PaginationQuery {
  reason?: string;
}

export const listReviewReports = async (query: ListReviewReportsQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.reason && { reason: query.reason }),
  };

  const [reports, total] = await Promise.all([
    prisma.reviewReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        reporter: { select: { id: true, fullName: true, email: true } },
        review: {
          include: {
            user: { select: { id: true, fullName: true } },
            vendor: { select: { id: true, storeName: true } },
          },
        },
      },
    }),
    prisma.reviewReport.count({ where }),
  ]);

  return { reports, meta: buildMeta(total, page, limit) };
};

export const dismissReport = async (reportId: string) => {
  const report = await prisma.reviewReport.findUnique({ where: { id: reportId } });
  if (!report) throw AppError.notFound("Review report");

  await prisma.reviewReport.delete({ where: { id: reportId } });
  return report;
};

/**
 * Soft-hide, not hard delete — VendorProfile.averageRating/totalReviews/
 * positiveReviews are cached aggregates. Recomputes the exact same way
 * user.service.ts's submit-review flow does, just filtered to live reviews.
 */
export const removeReview = async (reviewId: string, reason: string) => {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) throw AppError.notFound("Review");
  if (review.isRemoved) throw AppError.badRequest("Review is already removed.");

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: { isRemoved: true, removedReason: reason },
  });

  const liveReviews = await prisma.review.findMany({
    where: { vendorId: review.vendorId, isRemoved: false },
    select: { restaurantRating: true, foodRating: true },
  });

  const totalReviews = liveReviews.length;
  const sum = liveReviews.reduce(
    (acc, r) => acc + (r.restaurantRating + r.foodRating) / 2,
    0,
  );
  const newAvg = totalReviews > 0 ? parseFloat((sum / totalReviews).toFixed(1)) : 0;
  const positiveReviews = liveReviews.filter(
    (r) => (r.restaurantRating + r.foodRating) / 2 >= 4,
  ).length;

  await prisma.vendorProfile.update({
    where: { id: review.vendorId },
    data: { averageRating: newAvg, totalReviews, positiveReviews },
  });

  return updated;
};
