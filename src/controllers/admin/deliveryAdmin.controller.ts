// src/controllers/admin/deliveryAdmin.controller.ts
import { Request, Response } from "express";
import * as deliveryAdminService from "../../services/admin/deliveryAdmin.service";
import { extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

export const listDeliveries = asyncHandler(async (req: Request, res: Response) => {
  const { status, riderId, from, to } = req.query;
  const { deliveries, meta } = await deliveryAdminService.listDeliveries({
    ...extractPagination(req.query),
    status: status as any,
    riderId: riderId as string | undefined,
    from: from as string | undefined,
    to: to as string | undefined,
  });
  ok(res, deliveries, "Success", meta);
});

export const getDeliveryDetail = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await deliveryAdminService.getDeliveryDetail(req.params.id));
});
