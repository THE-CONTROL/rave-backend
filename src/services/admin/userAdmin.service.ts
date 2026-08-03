// src/services/admin/userAdmin.service.ts
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";
import { deleteAccount } from "../user.service";

export interface ListUsersQuery extends PaginationQuery {
  isActive?: boolean;
  search?: string;
}

export const listUsers = async (query: ListUsersQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    role: "user" as const,
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...(query.search && {
      OR: [
        { fullName: { contains: query.search, mode: "insensitive" as const } },
        { email: { contains: query.search, mode: "insensitive" as const } },
        { phone: { contains: query.search, mode: "insensitive" as const } },
      ],
    }),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        isActive: true,
        isEmailVerified: true,
        imageUrl: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { users, meta: buildMeta(total, page, limit) };
};

const _requireUser = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "user") throw AppError.notFound("User");
  return user;
};

export const getUserDetail = async (userId: string) => {
  const user = await _requireUser(userId);

  const [orderStats, transactions] = await Promise.all([
    prisma.order.aggregate({
      where: { userId },
      _count: true,
      _sum: { totalAmount: true },
    }),
    prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    isActive: user.isActive,
    isEmailVerified: user.isEmailVerified,
    imageUrl: user.imageUrl,
    createdAt: user.createdAt,
    orderCount: orderStats._count,
    totalSpend: orderStats._sum.totalAmount ?? 0,
    recentTransactions: transactions,
  };
};

export const suspendUser = async (userId: string) => {
  await _requireUser(userId);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { isActive: false },
  });
  await prisma.refreshToken.deleteMany({ where: { userId } });
  return updated;
};

export const reactivateUser = async (userId: string) => {
  await _requireUser(userId);
  return prisma.user.update({
    where: { id: userId },
    data: { isActive: true },
  });
};

export const softDeleteUser = async (userId: string): Promise<void> => {
  await _requireUser(userId);
  await deleteAccount(userId);
};
