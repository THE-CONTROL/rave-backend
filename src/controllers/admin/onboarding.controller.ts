// src/controllers/admin/onboarding.controller.ts
import { Request, Response } from "express";
import * as onboardingService from "../../services/admin/onboarding.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest } from "../../types";
import { ok, created, noContent, asyncHandler } from "../../utils";

const auditCtx = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get("user-agent") ?? undefined,
});

export const listSlides = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await onboardingService.listSlides(req.query.role as string | undefined));
});

export const getSlideById = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await onboardingService.getSlideById(req.params.id));
});

export const createSlide = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const slide = await onboardingService.createSlide(req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "onboardingSlide.create",
    entityType: "OnboardingSlide",
    entityId: slide.id,
    after: req.body,
    ...auditCtx(req),
  });

  created(res, slide, "Onboarding slide created.");
});

export const updateSlide = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await onboardingService.getSlideById(req.params.id);
  const updated = await onboardingService.updateSlide(req.params.id, req.body);

  await writeAuditLog({
    adminId: actor.id,
    action: "onboardingSlide.update",
    entityType: "OnboardingSlide",
    entityId: req.params.id,
    before,
    after: updated,
    ...auditCtx(req),
  });

  ok(res, updated, "Onboarding slide updated.");
});

export const deleteSlide = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const before = await onboardingService.getSlideById(req.params.id);
  await onboardingService.deleteSlide(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "onboardingSlide.delete",
    entityType: "OnboardingSlide",
    entityId: req.params.id,
    before,
    ...auditCtx(req),
  });

  noContent(res);
});

export const reorderSlides = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const { role, orderedIds } = req.body;
  await onboardingService.reorderSlides(orderedIds);

  await writeAuditLog({
    adminId: actor.id,
    action: "onboardingSlide.reorder",
    entityType: "OnboardingSlide",
    after: { role, orderedIds },
    ...auditCtx(req),
  });

  ok(res, await onboardingService.listSlides(role), "Slides reordered.");
});
