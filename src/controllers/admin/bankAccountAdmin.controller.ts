// src/controllers/admin/bankAccountAdmin.controller.ts
import { Request, Response } from "express";
import * as bankAccountAdminService from "../../services/admin/bankAccountAdmin.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest, extractPagination } from "../../types";
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

export const verifyBankAccount = asyncHandler(async (req: Request, res: Response) => {
  const actor = (req as AuthenticatedRequest).user;
  const updated = await bankAccountAdminService.verifyBankAccount(req.params.id);

  await writeAuditLog({
    adminId: actor.id,
    action: "bankAccount.verify",
    entityType: "BankAccount",
    entityId: req.params.id,
    after: { isVerified: true },
    ip: req.ip,
    userAgent: req.get("user-agent") ?? undefined,
  });

  ok(res, updated, "Bank account verified.");
});
