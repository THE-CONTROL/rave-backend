// src/controllers/admin/categoryAdmin.controller.ts
import { Request, Response } from "express";
import * as categoryAdminService from "../../services/admin/categoryAdmin.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest, extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

export const listAllCategories = asyncHandler(async (req: Request, res: Response) => {
  const { vendorId, search } = req.query;
  const { categories, meta } = await categoryAdminService.listAllCategories({
    ...extractPagination(req.query),
    vendorId: vendorId as string | undefined,
    search: search as string | undefined,
  });
  ok(res, categories, "Success", meta);
});

export const toggleCategoryActive = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await categoryAdminService.toggleCategoryActive(
    req.params.id,
    req.body.isActive,
  );

  await writeAuditLog({
    adminId: actor.id,
    action: "category.toggleActive",
    entityType: "Category",
    entityId: req.params.id,
    after: { isActive: updated.isActive },
    ip: req.ip,
    userAgent: req.get("user-agent") ?? undefined,
  });

  ok(res, updated, "Category updated.");
});
