// src/controllers/admin/refundAdmin.controller.ts
import { Request, Response } from "express";
import * as refundAdminService from "../../services/admin/refundAdmin.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest, extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

const auditCtx = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get("user-agent") ?? undefined,
});

export const listAllRefunds = asyncHandler(async (req: Request, res: Response) => {
  const { status, vendorId, userId } = req.query;
  const { refunds, meta } = await refundAdminService.listAllRefunds({
    ...extractPagination(req.query),
    status: status as any,
    vendorId: vendorId as string | undefined,
    userId: userId as string | undefined,
  });
  ok(res, refunds, "Success", meta);
});

export const getRefundDetail = asyncHandler(async (req: Request, res: Response) => {
  const refund = await refundAdminService.getRefundDetail(req.params.id);
  ok(res, refund, "Success");
});

export const forceApproveRefund = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await refundAdminService.forceApproveRefund(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "refund.forceApprove",
    entityType: "RefundRequest",
    entityId: req.params.id,
    after: { status: updated.status, amountApproved: updated.amountApproved },
    ...auditCtx(req),
  });

  ok(res, updated, "Refund approved.");
});

export const forceDeclineRefund = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await refundAdminService.forceDeclineRefund(req.params.id, req.body.reason);

  await writeAuditLog({
    adminId: actor.id,
    action: "refund.forceDecline",
    entityType: "RefundRequest",
    entityId: req.params.id,
    after: { status: updated.status, reason: req.body.reason },
    ...auditCtx(req),
  });

  ok(res, updated, "Refund declined.");
});
