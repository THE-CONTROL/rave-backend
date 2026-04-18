// src/controllers/order.controller.ts
import { Request, Response } from "express";
import * as orderService from "../services/order.service";
import { AuthenticatedRequest } from "../types";
import { ok, created, asyncHandler } from "../utils";

const uid = (req: Request) => (req as AuthenticatedRequest).user.id;

export const getTracking = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await orderService.getOrderTracking(uid(req), req.params.id));
});

export const cancelOrder = asyncHandler(async (req: Request, res: Response) => {
  await orderService.cancelOrderByUser(
    uid(req),
    req.params.id,
    req.body.reason,
  );
  ok(
    res,
    null,
    "Order cancelled. A full refund has been processed to your wallet.",
  );
});

export const reorder = asyncHandler(async (req: Request, res: Response) => {
  const result = await orderService.reorder(uid(req), req.params.id);
  ok(res, result, "Items added to cart.");
});

export const getCartSummary = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await orderService.calculateCartSummary(uid(req)));
  },
);

// Vendor side — advance order through the state machine
export const advanceStatus = asyncHandler(
  async (req: Request, res: Response) => {
    await orderService.advanceOrderStatus(
      uid(req),
      req.params.id,
      req.body.status,
      req.body.cancelReason,
    );
    ok(res, null, "Order status updated.");
  },
);

export const uploadOrderEvidence = asyncHandler(
  async (req: Request, res: Response) => {
    await orderService.uploadOrderEvidence(
      uid(req),
      req.params.id,
      req.body.url,
    );
    ok(res, null, "Video uploaded.");
  },
);
