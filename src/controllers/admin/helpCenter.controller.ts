// src/controllers/admin/helpCenter.controller.ts
import { Request, Response } from "express";
import * as helpCenterService from "../../services/admin/helpCenter.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest } from "../../types";
import { ok, created, noContent, asyncHandler } from "../../utils";

const auditCtx = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get("user-agent") ?? undefined,
});

// ── Categories ──

export const listHelpCategories = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await helpCenterService.listHelpCategories(req.query.role as string | undefined));
});

export const getHelpCategoryById = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await helpCenterService.getHelpCategoryById(req.params.id));
});

export const createHelpCategory = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const category = await helpCenterService.createHelpCategory(req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "helpCategory.create",
    entityType: "HelpCategory",
    entityId: category.id,
    after: req.body,
    ...auditCtx(req),
  });

  created(res, category, "Help category created.");
});

export const updateHelpCategory = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await helpCenterService.updateHelpCategory(req.params.id, req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "helpCategory.update",
    entityType: "HelpCategory",
    entityId: req.params.id,
    after: req.body,
    ...auditCtx(req),
  });

  ok(res, updated, "Help category updated.");
});

export const deleteHelpCategory = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  await helpCenterService.deleteHelpCategory(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "helpCategory.delete",
    entityType: "HelpCategory",
    entityId: req.params.id,
    ...auditCtx(req),
  });

  noContent(res);
});

// ── Articles ──

export const listHelpArticles = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await helpCenterService.listHelpArticles(req.query.categoryId as string | undefined));
});

export const getHelpArticleById = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await helpCenterService.getHelpArticleById(req.params.id));
});

export const createHelpArticle = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const article = await helpCenterService.createHelpArticle(req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "helpArticle.create",
    entityType: "HelpArticle",
    entityId: article.id,
    after: { title: req.body.title, categoryId: req.body.categoryId },
    ...auditCtx(req),
  });

  created(res, article, "Help article created.");
});

export const updateHelpArticle = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await helpCenterService.updateHelpArticle(req.params.id, req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "helpArticle.update",
    entityType: "HelpArticle",
    entityId: req.params.id,
    after: { title: req.body.title },
    ...auditCtx(req),
  });

  ok(res, updated, "Help article updated.");
});

export const deleteHelpArticle = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  await helpCenterService.deleteHelpArticle(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "helpArticle.delete",
    entityType: "HelpArticle",
    entityId: req.params.id,
    ...auditCtx(req),
  });

  noContent(res);
});
