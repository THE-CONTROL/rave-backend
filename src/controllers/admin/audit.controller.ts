// src/controllers/admin/audit.controller.ts
import { Request, Response } from "express";
import { listAuditLogs } from "../../services/admin/auditLog.service";
import { extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

export const getAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { adminId, entityType, action, from, to } = req.query;
  const { logs, meta } = await listAuditLogs({
    ...extractPagination(req.query),
    adminId: adminId as string | undefined,
    entityType: entityType as string | undefined,
    action: action as string | undefined,
    from: from as string | undefined,
    to: to as string | undefined,
  });
  ok(res, logs, "Success", meta);
});
