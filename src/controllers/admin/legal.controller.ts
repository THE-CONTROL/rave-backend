// src/controllers/admin/legal.controller.ts
import { Request, Response } from "express";
import * as legalService from "../../services/admin/legal.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest } from "../../types";
import { ok, created, noContent, asyncHandler } from "../../utils";

const auditCtx = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get("user-agent") ?? undefined,
});

export const listLegalDocs = asyncHandler(async (req: Request, res: Response) => {
  const { slug, role, includeHistory } = req.query;
  ok(
    res,
    await legalService.listLegalDocs({
      slug: slug as string | undefined,
      role: role as string | undefined,
      includeHistory: includeHistory === "true",
    }),
  );
});

export const getVersionHistory = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await legalService.getVersionHistory(req.params.slug, req.params.role));
});

export const createLegalDoc = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const { slug, role, ...content } = req.body;
  const doc = await legalService.createLegalDoc(slug, role, content, actor.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "legalDocument.create",
    entityType: "LegalDocument",
    entityId: doc.id,
    after: { slug, role, version: doc.version },
    ...auditCtx(req),
  });

  created(res, doc, "Legal document created.");
});

export const publishNewVersion = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const { slug, role } = req.params;
  const doc = await legalService.publishNewVersion(slug, role, req.body, actor.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "legalDocument.publishVersion",
    entityType: "LegalDocument",
    entityId: doc.id,
    after: { slug, role, version: doc.version },
    ...auditCtx(req),
  });

  ok(res, doc, "New version published.");
});

export const deleteLegalDoc = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await legalService.getLegalDocVersion(req.params.id);
  await legalService.deleteLegalDoc(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "legalDocument.delete",
    entityType: "LegalDocument",
    entityId: req.params.id,
    before: { slug: before.slug, role: before.role, version: before.version },
    ...auditCtx(req),
  });

  noContent(res);
});
