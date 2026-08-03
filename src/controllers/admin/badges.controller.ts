// src/controllers/admin/badges.controller.ts
import { Request, Response } from "express";
import * as badgesService from "../../services/admin/badges.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest } from "../../types";
import { ok, created, noContent, asyncHandler } from "../../utils";

const auditCtx = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get("user-agent") ?? undefined,
});

export const listBadges = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await badgesService.listBadges());
});

export const getBadgeById = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await badgesService.getBadgeById(req.params.id));
});

export const createBadge = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const badge = await badgesService.createBadge(req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "badge.create",
    entityType: "Badge",
    entityId: badge.id,
    after: req.body,
    ...auditCtx(req),
  });

  created(res, badge, "Badge created.");
});

export const updateBadge = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await badgesService.updateBadge(req.params.id, req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "badge.update",
    entityType: "Badge",
    entityId: req.params.id,
    after: req.body,
    ...auditCtx(req),
  });

  ok(res, updated, "Badge updated.");
});

export const deleteBadge = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  await badgesService.deleteBadge(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "badge.delete",
    entityType: "Badge",
    entityId: req.params.id,
    ...auditCtx(req),
  });

  noContent(res);
});

export const addRequirement = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const requirement = await badgesService.addRequirement(req.params.id, req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "badgeRequirement.create",
    entityType: "BadgeRequirement",
    entityId: requirement.id,
    after: req.body,
    ...auditCtx(req),
  });

  created(res, requirement, "Requirement added.");
});

export const updateRequirement = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await badgesService.updateRequirement(
    req.params.id,
    req.params.reqId,
    req.body,
  );

  await writeAuditLog({
    adminId: actor.id,
    action: "badgeRequirement.update",
    entityType: "BadgeRequirement",
    entityId: req.params.reqId,
    after: req.body,
    ...auditCtx(req),
  });

  ok(res, updated, "Requirement updated.");
});

export const deleteRequirement = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  await badgesService.deleteRequirement(req.params.id, req.params.reqId);

  await writeAuditLog({
    adminId: actor.id,
    action: "badgeRequirement.delete",
    entityType: "BadgeRequirement",
    entityId: req.params.reqId,
    ...auditCtx(req),
  });

  noContent(res);
});
