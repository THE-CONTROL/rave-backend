// src/services/admin/feedbackAdmin.service.ts
//
// Feedback was a pure write-only sink — users could submit it, nothing ever
// read it back. This is the admin inbox.
import { Role } from "@prisma/client";
import { prisma } from "../../config/database";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";

export interface ListFeedbackQuery extends PaginationQuery {
  type?: string;
  role?: Role;
  minRating?: number;
  userId?: string;
}

export const listFeedback = async (query: ListFeedbackQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.type && { type: query.type }),
    ...(query.role && { role: query.role }),
    ...(query.minRating !== undefined && { rating: { gte: query.minRating } }),
    ...(query.userId && { userId: query.userId }),
  };

  const [feedback, total] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { user: { select: { id: true, fullName: true, email: true } } },
    }),
    prisma.feedback.count({ where }),
  ]);

  return { feedback, meta: buildMeta(total, page, limit) };
};
