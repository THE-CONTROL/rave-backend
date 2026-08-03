// src/controllers/review.controller.ts
import { Request } from "express";
import * as reviewService from "../services/review.service";
import { AuthenticatedRequest } from "../types";
import { created, asyncHandler } from "../utils";

const uid = (req: Request) => (req as AuthenticatedRequest).user.id;

export const reportReview = asyncHandler(async (req, res) => {
  const result = await reviewService.reportReview(
    uid(req),
    req.params.id,
    req.body,
  );
  created(res, result, "Review reported. Our team will take a look.");
});
