// src/controllers/ad.controller.ts
import { Request, Response } from "express";
import * as adService from "../services/ad.service";
import { AuthenticatedRequest } from "../types";
import { ok, asyncHandler } from "../utils";

export const getStartupAd = asyncHandler(
  async (req: Request, res: Response) => {
    // The route requires `authenticate`, so `req.user` is always set here —
    // there is no unauthenticated path that would need a query-param fallback.
    const role = (req as AuthenticatedRequest).user.role;
    ok(res, await adService.getStartupAd(role));
  },
);

export const trackAdEvent = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await adService.trackAdEvent(req.body), "Event tracked.");
  },
);
