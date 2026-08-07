// src/services/admin/orderAdmin.service.ts
import { OrderStatus } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";

export interface ListOrdersQuery extends PaginationQuery {
  status?: OrderStatus;
  vendorId?: string;
  userId?: string;
  riderId?: string;
  from?: string;
  to?: string;
  search?: string;
}

export const listOrders = async (query: ListOrdersQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.status && { status: query.status }),
    ...(query.vendorId && { vendorId: query.vendorId }),
    ...(query.userId && { userId: query.userId }),
    ...(query.riderId && { delivery: { riderId: query.riderId } }),
    ...(query.search && {
      OR: [
        { orderId: { contains: query.search, mode: "insensitive" as const } },
        { user: { email: { contains: query.search, mode: "insensitive" as const } } },
      ],
    }),
    ...((query.from || query.to) && {
      createdAt: {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      },
    }),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        vendor: { select: { id: true, storeName: true } },
        delivery: {
          select: {
            id: true,
            status: true,
            riderId: true,
            rider: { select: { user: { select: { fullName: true } } } },
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, meta: buildMeta(total, page, limit) };
};

export const getOrderDetail = async (id: string) => {
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true } },
      vendor: { select: { id: true, storeName: true, logoUrl: true } },
      items: true,
      delivery: {
        include: { rider: { select: { id: true, user: { select: { fullName: true, phone: true } } } } },
      },
      transactions: true,
      review: true,
      refundRequests: true,
    },
  });
  if (!order) throw AppError.notFound("Order");
  return order;
};

// ─────────────────────────────────────────────────────────────────────────────
// Pending orders — payment-intent rows captured before a real Order exists
// (see PendingOrder's schema comment). A row that lingers past its payment's
// expected completion window usually means a stuck/failed webhook — this is
// the debugging surface for that, previously invisible outside the DB.
// PendingOrder has no `user` relation (just a raw userId), so this batches a
// manual lookup instead of an `include`.
// ─────────────────────────────────────────────────────────────────────────────

export const listPendingOrders = async (query: PaginationQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const [pending, total] = await Promise.all([
    prisma.pendingOrder.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.pendingOrder.count(),
  ]);

  const users = await prisma.user.findMany({
    where: { id: { in: pending.map((p) => p.userId) } },
    select: { id: true, fullName: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return {
    pending: pending.map((p) => ({ ...p, user: byId.get(p.userId) ?? null })),
    meta: buildMeta(total, page, limit),
  };
};
