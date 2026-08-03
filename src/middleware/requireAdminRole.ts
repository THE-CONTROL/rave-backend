// src/middleware/requireAdminRole.ts
import { Request, Response, NextFunction } from "express";
import { AdminRole } from "@prisma/client";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { AuthenticatedRequest } from "../types";
import { asyncHandler } from "../utils";

/**
 * Fine-grained permission check layered beneath the coarse `authorize("admin")`
 * role gate. `authorize` only checks the Prisma `Role` enum (i.e. "is this
 * account an admin at all"); this checks the admin's own sub-role
 * (`AdminProfile.adminRole`) against an explicit allow-list. `super_admin` is
 * never implicitly bypassed — every call site enumerates it explicitly.
 */
export const requireAdminRole = (...roles: AdminRole[]) =>
  asyncHandler(
    async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
      const user = (req as AuthenticatedRequest).user;

      const profile = await prisma.adminProfile.findUnique({
        where: { userId: user.id },
      });

      if (!profile?.isActive || !roles.includes(profile.adminRole)) {
        throw AppError.forbidden(
          "You do not have permission to perform this action.",
        );
      }

      next();
    },
  );
