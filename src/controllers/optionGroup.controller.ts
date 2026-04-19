// src/controllers/optionGroup.controller.ts
import { Request, Response } from "express";
import * as optionGroupService from "../services/optionGroup.service";
import { AuthenticatedRequest } from "../types";
import { ok, asyncHandler } from "../utils";

const uid = (req: Request) => (req as AuthenticatedRequest).user.id;

export const getOptionGroups = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await optionGroupService.getOptionGroups(uid(req)));
  },
);

export const getOptionGroupById = asyncHandler(
  async (req: Request, res: Response) => {
    ok(
      res,
      await optionGroupService.getOptionGroupById(uid(req), req.params.id),
    );
  },
);

export const createOptionGroup = asyncHandler(
  async (req: Request, res: Response) => {
    ok(
      res,
      await optionGroupService.createOptionGroup(uid(req), req.body),
      "Option group created.",
    );
  },
);

export const updateOptionGroup = asyncHandler(
  async (req: Request, res: Response) => {
    ok(
      res,
      await optionGroupService.updateOptionGroup(
        uid(req),
        req.params.id,
        req.body,
      ),
      "Option group updated.",
    );
  },
);

export const deleteOptionGroup = asyncHandler(
  async (req: Request, res: Response) => {
    ok(
      res,
      await optionGroupService.deleteOptionGroup(uid(req), req.params.id),
      "Option group deleted.",
    );
  },
);
