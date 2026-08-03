// src/controllers/admin/issueAdmin.controller.ts
import { Request, Response } from "express";
import * as issueAdminService from "../../services/admin/issueAdmin.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest, extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

const auditCtx = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get("user-agent") ?? undefined,
});

export const listIssues = asyncHandler(async (req: Request, res: Response) => {
  const { status, role, category } = req.query;
  const { issues, meta } = await issueAdminService.listIssues({
    ...extractPagination(req.query),
    status: status as any,
    role: role as any,
    category: category as string | undefined,
  });
  ok(res, issues, "Success", meta);
});

export const getIssueDetail = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await issueAdminService.getIssueDetail(req.params.id));
});

export const updateIssueStatus = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await issueAdminService.getIssueDetail(req.params.id);
  const updated = await issueAdminService.updateIssueStatus(req.params.id, req.body.status);

  await writeAuditLog({
    adminId: actor.id,
    action: "issue.updateStatus",
    entityType: "ReportedIssue",
    entityId: req.params.id,
    before: { status: before.status },
    after: { status: updated.status },
    ...auditCtx(req),
  });

  ok(res, updated, "Ticket status updated.");
});

export const respondToIssue = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await issueAdminService.respondToIssue(
    req.params.id,
    actor.id,
    req.body.message,
  );

  await writeAuditLog({
    adminId: actor.id,
    action: "issue.respond",
    entityType: "ReportedIssue",
    entityId: req.params.id,
    after: { message: req.body.message },
    ...auditCtx(req),
  });

  ok(res, updated, "Response sent.");
});
