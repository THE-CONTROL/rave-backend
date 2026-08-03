// src/controllers/admin/catalogAdmin.controller.ts
import { Request, Response } from "express";
import * as catalogAdminService from "../../services/admin/catalogAdmin.service";
import { extractPagination } from "../../types";
import { ok, asyncHandler } from "../../utils";

export const listMenuItems = asyncHandler(async (req: Request, res: Response) => {
  const { vendorId, search, isActive } = req.query;
  const { items, meta } = await catalogAdminService.listMenuItems({
    ...extractPagination(req.query),
    vendorId: vendorId as string | undefined,
    search: search as string | undefined,
    isActive: isActive === undefined ? undefined : isActive === "true",
  });
  ok(res, items, "Success", meta);
});

export const getMenuItemDetail = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await catalogAdminService.getMenuItemDetail(req.params.id));
});

export const listOptionGroups = asyncHandler(async (req: Request, res: Response) => {
  const { vendorId } = req.query;
  const { groups, meta } = await catalogAdminService.listOptionGroups({
    ...extractPagination(req.query),
    vendorId: vendorId as string | undefined,
  });
  ok(res, groups, "Success", meta);
});
