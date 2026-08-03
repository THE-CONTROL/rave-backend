// src/services/admin/adminNotifications.service.ts
//
// Admin's own notification inbox — mirrors the per-role notification block
// duplicated in user.service.ts / vendor.service.ts / rider.service.ts, minus
// settings (admins have no NotificationSettings toggles to gate against; see
// notifyAdmins in notification.events.ts).
import { prisma } from "../../config/database";

export const getNotifications = async (
  userId: string,
  query: { cursor?: string; type?: string; limit?: string },
) => {
  const take = Math.min(Number(query.limit) || 20, 50);

  const validTypes = ["order", "rider", "payment", "promo", "wallet", "account"];
  const typeFilter =
    query.type && query.type !== "all" && validTypes.includes(query.type)
      ? (query.type as any)
      : undefined;

  const where = {
    userId,
    ...(typeFilter ? { type: typeFilter } : {}),
  };

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasMore = notifications.length > take;
  const items = hasMore ? notifications.slice(0, take) : notifications;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { notifications: items, hasMore, nextCursor };
};

export const markAllNotificationsRead = (userId: string) =>
  prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });

export const deleteNotification = (userId: string, id: string) =>
  prisma.notification.deleteMany({ where: { id, userId } });

export const getUnreadNotificationCount = async (
  userId: string,
): Promise<{ count: number }> => {
  const count = await prisma.notification.count({
    where: { userId, isRead: false },
  });
  return { count };
};
