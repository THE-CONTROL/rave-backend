// src/controllers/admin/transactionAdmin.controller.ts
import { Request, Response } from "express";
import * as transactionAdminService from "../../services/admin/transactionAdmin.service";
import { extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

export const listTransactions = asyncHandler(async (req: Request, res: Response) => {
  const { type, status, userId, vendorId, riderId, from, to } = req.query;
  const { transactions, meta } = await transactionAdminService.listTransactions({
    ...extractPagination(req.query),
    type: type as any,
    status: status as any,
    userId: userId as string | undefined,
    vendorId: vendorId as string | undefined,
    riderId: riderId as string | undefined,
    from: from as string | undefined,
    to: to as string | undefined,
  });
  ok(res, transactions, "Success", meta);
});

export const getTransactionDetail = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await transactionAdminService.getTransactionDetail(req.params.id));
});
