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

export const suspendUser = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await userAdminService.suspendUser(req.params.id);

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
