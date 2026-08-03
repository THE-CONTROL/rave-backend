// src/controllers/admin/ads.controller.ts
import { Request, Response } from "express";
import * as adsService from "../../services/admin/ads.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest, extractPagination } from "../../types";
import { ok, created, noContent, asyncHandler } from "../../utils";

const auditCtx = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get("user-agent") ?? undefined,
});

export const listAds = asyncHandler(async (req: Request, res: Response) => {
  const { targetRole, isActive } = req.query;
  const { ads, meta } = await adsService.listAds({
    ...extractPagination(req.query),
    targetRole: targetRole as any,
    isActive: isActive === undefined ? undefined : isActive === "true",
  });
  ok(res, ads, "Success", meta);
});

export const getAdById = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await adsService.getAdById(req.params.id));
});

export const createAd = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const ad = await adsService.createAd(req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "ad.create",
    entityType: "Advertisement",
    entityId: ad.id,
    after: req.body,
    ...auditCtx(req),
  });

  created(res, ad, "Advertisement created.");
});

export const updateAd = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await adsService.getAdById(req.params.id);
  const updated = await adsService.updateAd(req.params.id, req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "ad.update",
    entityType: "Advertisement",
    entityId: req.params.id,
    before,
    after: updated,
    ...auditCtx(req),
  });

  ok(res, updated, "Advertisement updated.");
});

export const deleteAd = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await adsService.getAdById(req.params.id);
  await adsService.deleteAd(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "ad.delete",
    entityType: "Advertisement",
    entityId: req.params.id,
    before,
    ...auditCtx(req),
  });

  noContent(res);
});

export const getAdStats = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await adsService.getAdStats(req.params.id));
});
