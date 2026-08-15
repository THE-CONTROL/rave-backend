// src/services/admin/transactionAdmin.service.ts
import { TransactionType, TransactionStatus } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";

export interface ListTransactionsQuery extends PaginationQuery {
  type?: TransactionType;
  status?: TransactionStatus;
  userId?: string;
  vendorId?: string;
  riderId?: string;
  from?: string;
  to?: string;
  search?: string;
}

export const listTransactions = async (query: ListTransactionsQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.type && { type: query.type }),
    ...(query.status && { status: query.status }),
    ...(query.userId && { userId: query.userId }),
    ...(query.vendorId && { vendorId: query.vendorId }),
    ...(query.riderId && { riderId: query.riderId }),
    ...(query.search && {
      OR: [
        { reference: { contains: query.search, mode: "insensitive" as const } },
        { title: { contains: query.search, mode: "insensitive" as const } },
      ],
    }),
    ...((query.from || query.to) && {
      createdAt: {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      },
    }),
  };

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        vendor: { select: { id: true, storeName: true } },
        rider: { select: { id: true, user: { select: { fullName: true } } } },
        order: { select: { id: true, orderId: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  return { transactions, meta: buildMeta(total, page, limit) };
};

export const getTransactionDetail = async (id: string) => {
  const transaction = await prisma.transaction.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, email: true } },
      vendor: { select: { id: true, storeName: true } },
      rider: { select: { id: true, user: { select: { fullName: true } } } },
      order: { select: { id: true, orderId: true, status: true } },
    },
  });
  if (!transaction) throw AppError.notFound("Transaction");
  return transaction;
};
