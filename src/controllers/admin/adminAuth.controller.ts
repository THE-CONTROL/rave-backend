// src/controllers/admin/adminAuth.controller.ts
import { Request, Response } from "express";
import * as adminAuthService from "../../services/admin/adminAuth.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest, extractPagination } from "../../types";
import { ok, created, asyncHandler } from "../../utils";

export const getSelf = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  ok(res, await adminAuthService.getSelf(actor.id));
});

export const listAdmins = asyncHandler(async (req: Request, res: Response) => {
  const { adminRole, isActive, search } = req.query;
  const { admins, meta } = await adminAuthService.listAdmins({
    ...extractPagination(req.query),
    adminRole: adminRole as any,
    isActive: isActive === undefined ? undefined : isActive === "true",
    search: search as string | undefined,
  });
  ok(res, admins, "Success", meta);
});

export const createAdmin = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const admin = await adminAuthService.createAdmin(req.body, actor.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "admin.create",
    entityType: "AdminProfile",
    entityId: admin.adminProfile?.id,
    after: { email: admin.email, adminRole: admin.adminProfile?.adminRole },
    ip: req.ip,
    userAgent: req.get("user-agent") ?? undefined,
  });

  created(res, admin, "Admin created.");
});

export const getAdminById = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await adminAuthService.getAdminById(req.params.id));
});

export const updateAdmin = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await adminAuthService.getAdminById(req.params.id);
  const updated = await adminAuthService.updateAdmin(req.params.id, req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "admin.update",
    entityType: "AdminProfile",
    entityId: req.params.id,
    before: { adminRole: before.adminRole, isActive: before.isActive },
    after: { adminRole: updated.adminRole, isActive: updated.isActive },
    ip: req.ip,
    userAgent: req.get("user-agent") ?? undefined,
  });

  ok(res, updated, "Admin updated.");
});

export const deactivateAdmin = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = (req as AuthenticatedRequest).user;
    const deactivated = await adminAuthService.deactivateAdmin(req.params.id);

    await writeAuditLog({
      adminId: actor.id,
      action: "admin.deactivate",
      entityType: "AdminProfile",
      entityId: req.params.id,
      after: { isActive: deactivated.isActive },
      ip: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });

    ok(res, deactivated, "Admin deactivated.");
  },
);
