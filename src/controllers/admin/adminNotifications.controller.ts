// src/controllers/admin/adminNotifications.controller.ts
import { Request, Response } from "express";
import * as adminNotificationsService from "../../services/admin/adminNotifications.service";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { ok, noContent, asyncHandler } from "../../utils";

const uid = (req: Request) => (req as AuthenticatedRequest).user.id;

export const getNotifications = asyncHandler(
  async (req: Request, res: Response) => {
    ok(
      res,
      await adminNotificationsService.getNotifications(uid(req), req.query as any),
    );
  },
);

export const markAllNotificationsRead = asyncHandler(
  async (req: Request, res: Response) => {
    await adminNotificationsService.markAllNotificationsRead(uid(req));
    ok(res, null, "All notifications marked as read.");
  },
);

export const markNotificationRead = asyncHandler(
  async (req: Request, res: Response) => {
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: uid(req) },
      data: { isRead: true },
    });
    ok(res, null, "Notification marked as read.");
  },
);

export const deleteNotification = asyncHandler(
  async (req: Request, res: Response) => {
    await adminNotificationsService.deleteNotification(uid(req), req.params.id);
    noContent(res);
  },
);

export const getUnreadNotificationCount = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await adminNotificationsService.getUnreadNotificationCount(uid(req)));
  },
);
