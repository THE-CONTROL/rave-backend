// src/controllers/admin/vendorAdmin.controller.ts
import { Request, Response } from "express";
import * as vendorAdminService from "../../services/admin/vendorAdmin.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest, extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

const auditCtx = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get("user-agent") ?? undefined,
});

export const listVendors = asyncHandler(async (req: Request, res: Response) => {
  const { storeStatus, search } = req.query;
  const { vendors, meta } = await vendorAdminService.listVendors({
    ...extractPagination(req.query),
    storeStatus: storeStatus as any,
    search: search as string | undefined,
  });
  ok(res, vendors, "Success", meta);
});

export const getVendorDetail = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await vendorAdminService.getVendorDetail(req.params.id));
});

export const approveVendor = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await vendorAdminService.getVendorDetail(req.params.id);
  const updated = await vendorAdminService.approveVendor(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "vendor.approve",
    entityType: "VendorProfile",
    entityId: req.params.id,
    before: { storeStatus: before.storeStatus },
    after: { storeStatus: updated.storeStatus },
    ...auditCtx(req),
  });

  ok(res, updated, "Vendor approved.");
});

export const denyVendor = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await vendorAdminService.getVendorDetail(req.params.id);
  const updated = await vendorAdminService.denyVendor(req.params.id, req.body.reason);

  await writeAuditLog({
    adminId: actor.id,
    action: "vendor.deny",
    entityType: "VendorProfile",
    entityId: req.params.id,
    before: { storeStatus: before.storeStatus },
    after: { storeStatus: updated.storeStatus, reason: req.body.reason },
    ...auditCtx(req),
  });

  ok(res, updated, "Vendor denied.");
});

export const suspendVendor = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await vendorAdminService.getVendorDetail(req.params.id);
  const updated = await vendorAdminService.suspendVendor(req.params.id, req.body.reason);

  await writeAuditLog({
    adminId: actor.id,
    action: "vendor.suspend",
    entityType: "VendorProfile",
    entityId: req.params.id,
    before: { storeStatus: before.storeStatus },
    after: { storeStatus: updated.storeStatus, reason: req.body.reason },
    ...auditCtx(req),
  });

  ok(res, updated, "Vendor suspended.");
});

export const reactivateVendor = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await vendorAdminService.getVendorDetail(req.params.id);
  const updated = await vendorAdminService.reactivateVendor(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "vendor.reactivate",
    entityType: "VendorProfile",
    entityId: req.params.id,
    before: { storeStatus: before.storeStatus },
    after: { storeStatus: updated.storeStatus },
    ...auditCtx(req),
  });

  ok(res, updated, "Vendor reactivated.");
});
