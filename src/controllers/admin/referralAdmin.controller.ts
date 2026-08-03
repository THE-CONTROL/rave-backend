// src/controllers/admin/referralAdmin.controller.ts
import { Request, Response } from "express";
import * as referralAdminService from "../../services/admin/referralAdmin.service";
import { extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

export const listReferrals = asyncHandler(async (req: Request, res: Response) => {
  const { status, bonusPaid } = req.query;
  const { referrals, meta } = await referralAdminService.listReferrals({
    ...extractPagination(req.query),
    status: status as string | undefined,
    bonusPaid: bonusPaid === undefined ? undefined : bonusPaid === "true",
  });
  ok(res, referrals, "Success", meta);
});
