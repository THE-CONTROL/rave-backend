// src/controllers/myReviews.controller.ts
import { Request, Response } from "express";
import * as myReviewsService from "../services/myReviews.service";
import { AuthenticatedRequest } from "../types";
import { ok, noContent, asyncHandler } from "../utils";

const uid = (req: Request) => (req as AuthenticatedRequest).user.id;

export const getPending = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await myReviewsService.getPendingReviews(uid(req)));
});

export const getPast = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await myReviewsService.getPastReviews(uid(req)));
});

export const getDetail = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await myReviewsService.getReviewDetail(uid(req), req.params.id));
});

export const updateReview = asyncHandler(async (req: Request, res: Response) => {
  ok(
    res,
    await myReviewsService.updateReview(uid(req), req.params.id, req.body),
    "Review updated.",
  );
});

export const deleteReview = asyncHandler(async (req: Request, res: Response) => {
  await myReviewsService.deleteReview(uid(req), req.params.id);
  noContent(res);
});

export const getReviewOrderData = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await myReviewsService.getReviewOrderData(uid(req), req.params.orderId));
});
