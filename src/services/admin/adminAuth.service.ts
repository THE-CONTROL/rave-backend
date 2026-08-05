// src/services/admin/adminAuth.service.ts
import bcrypt from "bcryptjs";
import { AdminRole } from "@prisma/client";
import { prisma } from "../../config/database";
import { config } from "../../config";
import { logger } from "../../config/logger";
import { AppError } from "../../utils/AppError";
import { generateReferralCode } from "../../utils";
import { parsePagination, buildMeta } from "../../utils";
import { PaginationQuery } from "../../types";

const SALT_ROUNDS = 12;

/**
 * Creates the first super_admin on boot, gated by optional env vars — mirrors
 * seedPlatformConfig()/seedOnboardingSlides()/seedAds(). Admins can't
 * self-register via public /auth/signup, so day-0 bootstrap is the only way
 * to get an initial account. Upserts by email so redeploys don't duplicate;
 * silently no-ops if the env vars aren't set (never blocks a normal boot).
 */
export const seedSuperAdmin = async (): Promise<void> => {
  const { bootstrapEmail, bootstrapPassword, bootstrapName } = config.admin;
  if (!bootstrapEmail || !bootstrapPassword) return;

  const existing = await prisma.user.findUnique({
    where: { email: bootstrapEmail },
  });
  if (existing) return;

  const passwordHash = await bcrypt.hash(bootstrapPassword, SALT_ROUNDS);

  await prisma.user.create({
    data: {
      fullName: bootstrapName,
      email: bootstrapEmail,
      phone: `bootstrap-admin-${Date.now()}`,
      passwordHash,
      role: "admin",
      isEmailVerified: true,
      referralCode: generateReferralCode(),
      adminProfile: {
        create: { adminRole: "super_admin", isActive: true },
      },
    },
  });

  logger.info(`Bootstrap super_admin created (${bootstrapEmail})`);
};

export interface CreateAdminDto {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
  adminRole: AdminRole;
}

export const createAdmin = async (
  dto: CreateAdminDto,
  createdByAdminId: string,
) => {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: dto.email }, { phone: dto.phoneNumber }] },
  });
  if (existing) {
    throw AppError.conflict("An account with these details already exists.");
  }

  const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      fullName: dto.name,
      email: dto.email,
      phone: dto.phoneNumber,
      passwordHash,
      role: "admin",
      isEmailVerified: true, // created by an existing admin, no self-serve OTP flow
      referralCode: generateReferralCode(),
      adminProfile: {
        create: {
          adminRole: dto.adminRole,
          isActive: true,
          createdBy: createdByAdminId,
        },
      },
    },
    include: { adminProfile: true },
  });

  return user;
};

export interface ListAdminsQuery extends PaginationQuery {
  adminRole?: AdminRole;
  isActive?: boolean;
  search?: string;
}

export const listAdmins = async (query: ListAdminsQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.adminRole && { adminRole: query.adminRole }),
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...(query.search && {
      user: {
        OR: [
          { fullName: { contains: query.search, mode: "insensitive" as const } },
          { email: { contains: query.search, mode: "insensitive" as const } },
        ],
      },
    }),
  };

  const [admins, total] = await Promise.all([
    prisma.adminProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true } },
      },
    }),
    prisma.adminProfile.count({ where }),
  ]);

  return { admins, meta: buildMeta(total, page, limit) };
};

export const getAdminById = async (id: string) => {
  const admin = await prisma.adminProfile.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true } },
    },
  });
  if (!admin) throw AppError.notFound("Admin");
  return admin;
};

/** Any signed-in admin's own profile — unlike getAdminById/listAdmins, not super_admin-gated. */
export const getSelf = async (userId: string) => {
  const admin = await prisma.adminProfile.findUnique({
    where: { userId },
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true, imageUrl: true } },
    },
  });
  if (!admin) throw AppError.notFound("Admin profile");
  return admin;
};

export interface UpdateAdminDto {
  adminRole?: AdminRole;
  isActive?: boolean;
}

export const updateAdmin = async (id: string, dto: UpdateAdminDto) => {
  const existing = await prisma.adminProfile.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Admin");

  if (existing.adminRole === "super_admin" && dto.isActive === false) {
    throw AppError.badRequest("Super admin accounts can't be deactivated.");
  }

  return prisma.adminProfile.update({
    where: { id },
    data: dto,
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true } },
    },
  });
};

/** Deactivation, not deletion — preserves audit-log actor history. */
export const deactivateAdmin = async (id: string) => {
  const existing = await prisma.adminProfile.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Admin");

  if (existing.adminRole === "super_admin") {
    throw AppError.badRequest("Super admin accounts can't be deactivated.");
  }

  const updated = await prisma.adminProfile.update({
    where: { id },
    data: { isActive: false },
  });

  await prisma.refreshToken.deleteMany({ where: { userId: existing.userId } });

  return updated;
};
