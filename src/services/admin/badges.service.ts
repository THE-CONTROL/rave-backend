// src/services/admin/badges.service.ts
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";

export const listBadges = () =>
  prisma.badge.findMany({
    orderBy: { name: "asc" },
    include: { requirements: true },
  });

export const getBadgeById = async (id: string) => {
  const badge = await prisma.badge.findUnique({
    where: { id },
    include: { requirements: true },
  });
  if (!badge) throw AppError.notFound("Badge");
  return badge;
};

export interface BadgeDto {
  name: string;
  icon: string;
  description?: string;
  xpReward?: number;
  perks?: string[];
}

export const createBadge = (data: BadgeDto) => prisma.badge.create({ data });

export const updateBadge = async (id: string, data: Partial<BadgeDto>) => {
  await getBadgeById(id);
  return prisma.badge.update({ where: { id }, data });
};

export const deleteBadge = async (id: string) => {
  await getBadgeById(id);
  await prisma.badge.delete({ where: { id } });
};

export interface BadgeRequirementDto {
  label: string;
  total?: number;
}

export const addRequirement = async (badgeId: string, data: BadgeRequirementDto) => {
  await getBadgeById(badgeId);
  return prisma.badgeRequirement.create({ data: { ...data, badgeId } });
};

const _requireRequirement = async (badgeId: string, reqId: string) => {
  const req = await prisma.badgeRequirement.findUnique({ where: { id: reqId } });
  if (!req || req.badgeId !== badgeId) throw AppError.notFound("Badge requirement");
  return req;
};

export const updateRequirement = async (
  badgeId: string,
  reqId: string,
  data: Partial<BadgeRequirementDto>,
) => {
  await _requireRequirement(badgeId, reqId);
  return prisma.badgeRequirement.update({ where: { id: reqId }, data });
};

export const deleteRequirement = async (badgeId: string, reqId: string) => {
  await _requireRequirement(badgeId, reqId);
  await prisma.badgeRequirement.delete({ where: { id: reqId } });
};
