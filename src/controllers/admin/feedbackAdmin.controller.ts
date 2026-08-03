// src/controllers/admin/feedbackAdmin.controller.ts
import { Request, Response } from "express";
import * as feedbackAdminService from "../../services/admin/feedbackAdmin.service";
import { extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

export const listFeedback = asyncHandler(async (req: Request, res: Response) => {
  const { type, role, minRating } = req.query;
  const { feedback, meta } = await feedbackAdminService.listFeedback({
    ...extractPagination(req.query),
    type: type as string | undefined,
    role: role as any,
    minRating: minRating ? Number(minRating) : undefined,
  });
  ok(res, feedback, "Success", meta);
});
