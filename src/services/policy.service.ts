// src/services/policy.service.ts
import { Role } from "@prisma/client";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { buildMeta, parsePagination } from "../utils";
import { PaginationQuery } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Reported Issues
// ─────────────────────────────────────────────────────────────────────────────

export const getIssues = async (
  userId: string,
  role: Role,
  status?: string,
  query: PaginationQuery = {},
) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    userId,
    role,
    ...(status && status !== "All"
      ? { status: status.toUpperCase() as "OPEN" | "IN_REVIEW" | "RESOLVED" }
      : {}),
  };

  const [issues, total] = await Promise.all([
    prisma.reportedIssue.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.reportedIssue.count({ where }),
  ]);

  return { issues, meta: buildMeta(total, page, limit) };
};

export const getIssueById = async (userId: string, issueId: string) => {
  const issue = await prisma.reportedIssue.findFirst({
    where: { id: issueId, userId },
  });
  if (!issue) throw AppError.notFound("Issue");
  return issue;
};

export const submitIssue = async (
  userId: string,
  role: Role,
  data: {
    urgency: string;
    category: string;
    transactionId?: string;
    description: string;
    attachments?: string[];
  },
) => {
  return prisma.reportedIssue.create({
    data: {
      userId,
      role,
      title: `${data.category} Issue`,
      category: data.category,
      urgency: data.urgency,
      description: data.description,
      attachments: data.attachments ?? [],
      transactionId: data.transactionId,
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Feedback
// ─────────────────────────────────────────────────────────────────────────────

export const submitFeedback = async (
  userId: string,
  role: Role,
  data: { type: string; message: string; rating?: number; images?: string[] },
) => {
  return prisma.feedback.create({
    data: {
      userId,
      role,
      type: data.type,
      message: data.message,
    },
  });
};

/**
 * Returns recent order/transaction references for the issue report dropdown.
 * Scoped by role — users see their orders, vendors see their store orders,
 * riders see their deliveries.
 */
export const getRecentRefs = async (userId: string, role: Role) => {
  if (role === "user") {
    const orders = await prisma.order.findMany({
      where: { userId },
      select: { id: true, orderId: true, createdAt: true, totalAmount: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return orders.map((o) => ({
      id: o.orderId,
      label: `Order ${o.orderId} — ₦${o.totalAmount.toLocaleString()}`,
    }));
  }

  if (role === "vendor") {
    const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
    if (!vendor) return [];
    const txs = await prisma.transaction.findMany({
      where: { vendorId: vendor.id },
      select: { id: true, title: true, amount: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return txs.map((t) => ({
      id: t.id,
      label: `${t.title} — ₦${t.amount.toLocaleString()}`,
    }));
  }

  if (role === "rider") {
    const rider = await prisma.riderProfile.findUnique({ where: { userId } });
    if (!rider) return [];
    const txs = await prisma.transaction.findMany({
      where: { riderId: rider.id },
      select: { id: true, title: true, amount: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return txs.map((t) => ({
      id: t.id,
      label: `${t.title} — ₦${t.amount.toLocaleString()}`,
    }));
  }

  return [];
};

export const getLegalDocument = async (role: Role, slug: string) => {
  const doc = await prisma.legalDocument.findUnique({
    where: { slug_role: { slug, role } },
  });
  return doc ?? null;
};

export const getHelpCategories = async (role: Role) => {
  return prisma.helpCategory.findMany({
    where: { role },
    include: {
      articles: {
        select: {
          articleId: true,
          title: true,
          sub: true,
          popular: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { sortOrder: "asc" },
  });
};

export const getHelpArticle = async (role: Role, articleId: string) => {
  return await prisma.helpArticle.findFirst({
    where: {
      articleId,
      role,
    },
  });
};
