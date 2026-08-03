// src/controllers/admin/analytics.controller.ts
import { Request, Response } from "express";
import * as analyticsService from "../../services/admin/analytics.service";
import { ok, asyncHandler } from "../../utils";

export const getOverview = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await analyticsService.getOverview());
});

export const getGrowth = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await analyticsService.getGrowth(req.query.range as string | undefined));
});

export const getOrderAnalytics = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await analyticsService.getOrderAnalytics(req.query.range as string | undefined));
});

export const getRevenueAnalytics = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await analyticsService.getRevenueAnalytics(req.query.range as string | undefined));
});

export const getTopVendors = asyncHandler(async (req: Request, res: Response) => {
  const { range, limit } = req.query;
  ok(
    res,
    await analyticsService.getTopVendors(
      range as string | undefined,
      limit ? Number(limit) : undefined,
    ),
  );
});

export const getTopRiders = asyncHandler(async (req: Request, res: Response) => {
  const { range, limit } = req.query;
  ok(
    res,
    await analyticsService.getTopRiders(
      range as string | undefined,
      limit ? Number(limit) : undefined,
    ),
  );
});

export const getUserEngagement = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await analyticsService.getUserEngagement(req.query.range as string | undefined));
});
