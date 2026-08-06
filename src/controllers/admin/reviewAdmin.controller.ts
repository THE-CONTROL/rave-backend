// src/controllers/admin/reviewAdmin.controller.ts
import { Request, Response } from "express";
import * as reviewAdminService from "../../services/admin/reviewAdmin.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest, extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

const auditCtx = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get("user-agent") ?? undefined,
});

export const listReviewReports = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = req.query;
  const { reports, meta } = await reviewAdminService.listReviewReports({
    ...extractPagination(req.query),
    reason: reason as string | undefined,
  });
  ok(res, reports, "Success", meta);
});

export const listReviews = asyncHandler(async (req: Request, res: Response) => {
  const { vendorId, userId, riderId, isRemoved } = req.query;
  const { reviews, meta } = await reviewAdminService.listReviews({
    ...extractPagination(req.query),
    vendorId: vendorId as string | undefined,
    userId: userId as string | undefined,
    riderId: riderId as string | undefined,
    isRemoved: isRemoved === undefined ? undefined : isRemoved === "true",
  });
  ok(res, reviews, "Success", meta);
});

export const dismissReport = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await reviewAdminService.dismissReport(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "reviewReport.dismiss",
    entityType: "ReviewReport",
    entityId: req.params.id,
    before,
    ...auditCtx(req),
  });

  ok(res, null, "Report dismissed.");
});

export const removeReview = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await reviewAdminService.removeReview(req.params.id, req.body.reason);

  await writeAuditLog({
    adminId: actor.id,
    action: "review.remove",
    entityType: "Review",
    entityId: req.params.id,
    after: { isRemoved: true, reason: req.body.reason },
    ...auditCtx(req),
  });

  ok(res, updated, "Review removed.");
});
