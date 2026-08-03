// src/controllers/admin/orderAdmin.controller.ts
import { Request, Response } from "express";
import * as orderAdminService from "../../services/admin/orderAdmin.service";
import { extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

export const listOrders = asyncHandler(async (req: Request, res: Response) => {
  const { status, vendorId, userId, riderId, from, to, search } = req.query;
  const { orders, meta } = await orderAdminService.listOrders({
    ...extractPagination(req.query),
    status: status as any,
    vendorId: vendorId as string | undefined,
    userId: userId as string | undefined,
    riderId: riderId as string | undefined,
    from: from as string | undefined,
    to: to as string | undefined,
    search: search as string | undefined,
  });
  ok(res, orders, "Success", meta);
});

export const getOrderDetail = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await orderAdminService.getOrderDetail(req.params.id));
});

export const listPendingOrders = asyncHandler(async (req: Request, res: Response) => {
  const { pending, meta } = await orderAdminService.listPendingOrders(
    extractPagination(req.query),
  );
  ok(res, pending, "Success", meta);
});
