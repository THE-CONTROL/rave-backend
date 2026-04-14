// src/controllers/wallet.controller.ts
import { Request, Response } from "express";
import * as walletService from "../services/wallet.service";
import { AuthenticatedRequest } from "../types";
import { ok, asyncHandler } from "../utils";

const uid = (req: Request) => (req as AuthenticatedRequest).user.id;

export const getVirtualAccount = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await walletService.getVirtualAccount(uid(req)));
  },
);

export const getTopUpMethods = asyncHandler(
  async (_req: Request, res: Response) => {
    ok(res, walletService.getTopUpMethods());
  },
);

export const getCheckoutPreview = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await walletService.getCheckoutPreview(uid(req)));
  },
);
