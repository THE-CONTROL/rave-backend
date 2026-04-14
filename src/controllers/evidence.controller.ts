// src/controllers/evidence.controller.ts
import { Request, Response } from "express";
import * as evidenceService from "../services/evidence.service";
import { AuthenticatedRequest } from "../types";
import { ok, asyncHandler } from "../utils";
import { AppError } from "../utils/AppError";

const uid = (req: Request) => (req as AuthenticatedRequest).user.id;

export const uploadEvidence = asyncHandler(async (req, res) => {
  const { url } = req.body;
  if (!url) throw AppError.badRequest("No URL provided.");
  ok(
    res,
    await evidenceService.uploadOrderEvidence(uid(req), req.params.id, url),
  );
});
