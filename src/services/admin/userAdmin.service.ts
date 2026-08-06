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

  // Orders/reviews/tickets/refunds/feedback are unbounded and surfaced as
  // "view all" links to the existing filtered admin list pages instead of
  // being embedded wholesale here — savedLocations/savedBanks/notification
  // settings are small, per-user-bounded, so those ARE embedded directly.
  // favoriteRestaurant/favoriteProduct/cartItem are counts only — high-volume,
  // ephemeral-ish data with no dedicated admin list view.
  const [
    orderStats,
    transactions,
    savedLocations,
    savedBanks,
    notificationSettings,
    reviewCount,
    ticketCount,
    refundCount,
    feedbackCount,
    sentReferralsCount,
    receivedReferral,
    favoriteRestaurantCount,
    favoriteProductCount,
    cartItemCount,
  ] = await Promise.all([
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
    prisma.savedLocation.findMany({ where: { userId } }),
    prisma.bankAccount.findMany({ where: { userId } }),
    prisma.notificationSettings.findUnique({ where: { userId } }),
    prisma.review.count({ where: { userId } }),
    prisma.reportedIssue.count({ where: { userId } }),
    prisma.refundRequest.count({ where: { userId } }),
    prisma.feedback.count({ where: { userId } }),
    prisma.referral.count({ where: { referrerId: userId } }),
    prisma.referral.findUnique({ where: { refereeId: userId }, select: { status: true } }),
    prisma.favoriteRestaurant.count({ where: { userId } }),
    prisma.favoriteProduct.count({ where: { userId } }),
    prisma.cartItem.count({ where: { userId } }),
  ]);

  const suspendedByAdmin = user.suspendedBy
    ? await prisma.user.findUnique({ where: { id: user.suspendedBy }, select: { fullName: true } })
    : null;

  return {
    id: user.id,
    accountId: user.accountId,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    isActive: user.isActive,
    isEmailVerified: user.isEmailVerified,
    imageUrl: user.imageUrl,
    location: user.location,
    profileCompletion: user.profileCompletion,
    referralCode: user.referralCode,
    pushToken: user.pushToken,
    appliedPromoCode: user.appliedPromoCode,
    suspendedReason: user.suspendedReason,
    suspendedAt: user.suspendedAt,
    suspendedByName: suspendedByAdmin?.fullName ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    orderCount: orderStats._count,
    totalSpend: orderStats._sum.totalAmount ?? 0,
    recentTransactions: transactions,
    savedLocations,
    savedBanks,
    notificationSettings,
    reviewCount,
    ticketCount,
    refundCount,
    feedbackCount,
    referrals: { sentCount: sentReferralsCount, receivedStatus: receivedReferral?.status ?? null },
    favoriteRestaurantCount,
    favoriteProductCount,
    cartItemCount,
  };
};

export interface ListUserNotificationsQuery extends PaginationQuery {}

export const listUserNotifications = async (userId: string, query: ListUserNotificationsQuery) => {
  await _requireUser(userId);
  const { page, limit, skip } = parsePagination(query);

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where: { userId } }),
  ]);

  return { notifications, meta: buildMeta(total, page, limit) };
};

export const suspendUser = async (userId: string, reason: string | undefined, adminId: string) => {
  await _requireUser(userId);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      isActive: false,
      suspendedReason: reason ?? null,
      suspendedAt: new Date(),
      suspendedBy: adminId,
    },
  });
  await prisma.refreshToken.deleteMany({ where: { userId } });
  return updated;
};

export const reactivateUser = async (userId: string) => {
  await _requireUser(userId);
  return prisma.user.update({
    where: { id: userId },
    data: { isActive: true, suspendedReason: null, suspendedAt: null, suspendedBy: null },
  });
};

export const softDeleteUser = async (userId: string): Promise<void> => {
  await _requireUser(userId);
  await deleteAccount(userId);
};
