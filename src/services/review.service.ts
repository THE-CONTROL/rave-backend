// src/services/review.service.ts
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";

export const reportReview = async (
  userId: string,
  reviewId: string,
  data: { reason: string; comment?: string },
) => {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) throw AppError.notFound("Review");

  return prisma.reviewReport.create({
    data: {
      reviewId,
      reporterId: userId,
      reason: data.reason,
      comment: data.comment,
    },
  });
};
