// src/controllers/admin/userAdmin.controller.ts
import { Request, Response } from "express";
import * as userAdminService from "../../services/admin/userAdmin.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest, extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

const auditCtx = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get("user-agent") ?? undefined,
});

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const { isActive, search } = req.query;
  const { users, meta } = await userAdminService.listUsers({
    ...extractPagination(req.query),
    isActive: isActive === undefined ? undefined : isActive === "true",
    search: search as string | undefined,
  });
  ok(res, users, "Success", meta);
});

export const getUserDetail = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await userAdminService.getUserDetail(req.params.id));
});

export const listUserNotifications = asyncHandler(async (req: Request, res: Response) => {
  const { notifications, meta } = await userAdminService.listUserNotifications(
    req.params.id,
    extractPagination(req.query),
  );
  ok(res, notifications, "Success", meta);
});

export const listUserSearchHistory = asyncHandler(async (req: Request, res: Response) => {
  const { searches, meta } = await userAdminService.listUserSearchHistory(
    req.params.id,
    extractPagination(req.query),
  );
  ok(res, searches, "Success", meta);
});

export const listUserCart = asyncHandler(async (req: Request, res: Response) => {
  const { items, meta } = await userAdminService.listUserCart(req.params.id, extractPagination(req.query));
  ok(res, items, "Success", meta);
});

export const listUserFavorites = asyncHandler(async (req: Request, res: Response) => {
  const favorites = await userAdminService.listUserFavorites(req.params.id, extractPagination(req.query));
  ok(res, favorites);
});

export const suspendUser = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await userAdminService.suspendUser(req.params.id, req.body?.reason, actor.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "user.suspend",
    entityType: "User",
    entityId: req.params.id,
    after: { isActive: updated.isActive, reason: req.body?.reason },
    ...auditCtx(req),
  });

  ok(res, updated, "User suspended.");
});

export const reactivateUser = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await userAdminService.reactivateUser(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "user.reactivate",
    entityType: "User",
    entityId: req.params.id,
    after: { isActive: updated.isActive },
    ...auditCtx(req),
  });

  ok(res, updated, "User reactivated.");
});

export const softDeleteUser = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  await userAdminService.softDeleteUser(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "user.delete",
    entityType: "User",
    entityId: req.params.id,
    ...auditCtx(req),
  });

  ok(res, null, "User account deleted.");
});
