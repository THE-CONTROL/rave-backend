// src/controllers/admin/config.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database";
import * as configService from "../../services/config.service";
import { writeAuditLog } from "../../services/admin/auditLog.service";
import { AuthenticatedRequest } from "../../types";
import { ok, asyncHandler } from "../../utils";

export const listConfigs = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await configService.getAllConfigs());
});

export const updateConfig = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = (req as AuthenticatedRequest).user;
    const { key } = req.params;
    const { value } = req.body;

    const before = await prisma.platformConfig.findUnique({ where: { key } });

    await configService.updateConfig(key, value, actor.id);

    await writeAuditLog({
      adminId: actor.id,
      action: "config.update",
      entityType: "PlatformConfig",
      entityId: key,
      before: before ? { value: before.value } : undefined,
      after: { value },
      ip: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });

    ok(res, await configService.getAllConfigs(), "Config updated.");
  },
);
