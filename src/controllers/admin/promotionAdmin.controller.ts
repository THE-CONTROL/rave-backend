// src/controllers/admin/promotionAdmin.controller.ts
import { Request, Response } from "express";
import * as promotionAdminService from "../../services/admin/promotionAdmin.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest, extractPagination } from "../../types";
import { ok, created, noContent, asyncHandler } from "../../utils";

const auditCtx = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get("user-agent") ?? undefined,
});

export const listAllPromotions = asyncHandler(async (req: Request, res: Response) => {
  const { vendorId, isActive, search } = req.query;
  const { promotions, meta } = await promotionAdminService.listAllPromotions({
    ...extractPagination(req.query),
    vendorId: vendorId as string | undefined,
    isActive: isActive === undefined ? undefined : isActive === "true",
    search: search as string | undefined,
  });
  ok(res, promotions, "Success", meta);
});

export const getPromotionDetail = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await promotionAdminService.getPromotionDetail(req.params.id));
});

export const deactivatePromotion = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await promotionAdminService.deactivatePromotion(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "promotion.deactivate",
    entityType: "Promotion",
    entityId: req.params.id,
    after: { isActive: updated.isActive },
    ip: req.ip,
    userAgent: req.get("user-agent") ?? undefined,
  });

  ok(res, updated, "Promotion deactivated.");
});

export const createPromotion = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const promotion = await promotionAdminService.createPromotion(req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "promotion.create",
    entityType: "Promotion",
    entityId: promotion.id,
    after: { title: promotion.title, vendorId: promotion.vendorId, promoCode: promotion.promoCode },
    ...auditCtx(req),
  });

  created(res, promotion, "Promotion created.");
});

export const updatePromotion = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await promotionAdminService.updatePromotion(req.params.id, req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "promotion.update",
    entityType: "Promotion",
    entityId: req.params.id,
    after: req.body,
    ...auditCtx(req),
  });

  ok(res, updated, "Promotion updated.");
});

export const deletePromotion = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await promotionAdminService.getPromotionDetail(req.params.id);
  await promotionAdminService.deletePromotion(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "promotion.delete",
    entityType: "Promotion",
    entityId: req.params.id,
    before: { title: before.title, vendorId: before.vendorId, promoCode: before.promoCode },
    ...auditCtx(req),
  });

  noContent(res);
});
