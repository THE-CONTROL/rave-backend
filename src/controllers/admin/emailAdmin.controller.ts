// src/controllers/admin/emailAdmin.controller.ts
import { Request, Response } from "express";
import * as emailAdminService from "../../services/admin/emailAdmin.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest } from "../../types";
import { ok, asyncHandler } from "../../utils";

export const sendEmail = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const { subject, message, recipientId, roles } = req.body;
  const result = await emailAdminService.sendBulkEmail({
    subject,
    message,
    recipientId,
    roles,
  });

  // Audit the broadcast's metadata (who/what/how many) — not the full
  // message body, to keep the audit log from ballooning on repeated sends.
  await writeAuditLog({
    adminId: actor.id,
    action: "email.send",
    entityType: "User",
    after: { subject, recipientId, roles, recipientCount: result.recipientCount },
    ip: req.ip,
    userAgent: req.get("user-agent") ?? undefined,
  });

  ok(res, result, `Email queued for ${result.recipientCount} recipient(s).`);
});
