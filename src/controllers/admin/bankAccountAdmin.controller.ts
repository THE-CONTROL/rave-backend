// src/controllers/admin/bankAccountAdmin.controller.ts
import { Request, Response } from "express";
import * as bankAccountAdminService from "../../services/admin/bankAccountAdmin.service";
import { extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

export const listBankAccounts = asyncHandler(async (req: Request, res: Response) => {
  const { search, isVerified } = req.query;
  const { accounts, meta } = await bankAccountAdminService.listBankAccounts({
    ...extractPagination(req.query),
    search: search as string | undefined,
    isVerified: isVerified === undefined ? undefined : isVerified === "true",
  });
  ok(res, accounts, "Success", meta);
});
