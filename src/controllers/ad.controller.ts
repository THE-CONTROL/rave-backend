// src/controllers/ad.controller.ts
import { Request, Response } from "express";
import * as adService from "../services/ad.service";
import { AuthenticatedRequest } from "../types";
import { ok, asyncHandler } from "../utils";
import { Role } from "@prisma/client";

export const getStartupAd = asyncHandler(async (req: Request, res: Response) => {
  const role = (
    (req as AuthenticatedRequest).user?.role ?? req.query.role
  ) as Role;
  ok(res, await adService.getStartupAd(role));
});

export const trackAdEvent = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await adService.trackAdEvent(req.body), "Event tracked.");
});
