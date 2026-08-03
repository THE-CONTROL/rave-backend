// src/controllers/admin/riderAdmin.controller.ts
import { Request, Response } from "express";
import * as riderAdminService from "../../services/admin/riderAdmin.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest, extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

const auditCtx = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get("user-agent") ?? undefined,
});

export const listRiders = asyncHandler(async (req: Request, res: Response) => {
  const { status, search } = req.query;
  const { riders, meta } = await riderAdminService.listRiders({
    ...extractPagination(req.query),
    status: status as any,
    search: search as string | undefined,
  });
  ok(res, riders, "Success", meta);
});

export const getRiderDetail = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await riderAdminService.getRiderDetail(req.params.id));
});

export const verifyRider = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await riderAdminService.getRiderDetail(req.params.id);
  const updated = await riderAdminService.verifyRider(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "rider.verify",
    entityType: "RiderProfile",
    entityId: req.params.id,
    before: { status: before.status },
    after: { status: updated.status },
    ...auditCtx(req),
  });

  ok(res, updated, "Rider verified.");
});

export const rejectRider = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const { field, reason } = req.body;
  const before = await riderAdminService.getRiderDetail(req.params.id);
  const updated = await riderAdminService.rejectRider(req.params.id, field, reason);

  await writeAuditLog({
    adminId: actor.id,
    action: "rider.reject",
    entityType: "RiderProfile",
    entityId: req.params.id,
    before: { status: before.status },
    after: { status: updated.status, field, reason },
    ...auditCtx(req),
  });

  ok(res, updated, "Rider document rejected.");
});

export const suspendRider = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await riderAdminService.getRiderDetail(req.params.id);
  const updated = await riderAdminService.suspendRider(req.params.id, req.body.reason);

  await writeAuditLog({
    adminId: actor.id,
    action: "rider.suspend",
    entityType: "RiderProfile",
    entityId: req.params.id,
    before: { status: before.status },
    after: { status: updated.status, reason: req.body.reason },
    ...auditCtx(req),
  });

  ok(res, updated, "Rider suspended.");
});

export const reactivateRider = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await riderAdminService.getRiderDetail(req.params.id);
  const updated = await riderAdminService.reactivateRider(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "rider.reactivate",
    entityType: "RiderProfile",
    entityId: req.params.id,
    before: { status: before.status },
    after: { status: updated.status },
    ...auditCtx(req),
  });

  ok(res, updated, "Rider reactivated.");
});
