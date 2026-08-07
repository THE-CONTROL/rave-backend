// src/services/admin/badges.service.ts
import { BadgeMetric } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";
import { seedBadgeForAllVendors, evaluateAllVendorsForBadge } from "../badgeEvaluation.service";

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

export const createBadge = async (data: BadgeDto) => {
  const badge = await prisma.badge.create({ data });
  // No requirements exist yet at this point (added separately below), so
  // this just seeds tracking rows — there's nothing to actually unlock yet.
  await seedBadgeForAllVendors(badge.id);
  return badge;
};

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
  metric?: BadgeMetric;
  total?: number;
}

export const addRequirement = async (badgeId: string, data: BadgeRequirementDto) => {
  await getBadgeById(badgeId);
  const req = await prisma.badgeRequirement.create({ data: { ...data, badgeId } });
  // A brand-new requirement could already be met by vendors tracking this
  // badge (e.g. adding "500 orders" to a badge a top vendor already clears).
  await evaluateAllVendorsForBadge(badgeId);
  return req;
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
  const req = await prisma.badgeRequirement.update({ where: { id: reqId }, data });
  await evaluateAllVendorsForBadge(badgeId);
  return req;
};

export const deleteRequirement = async (badgeId: string, reqId: string) => {
  await _requireRequirement(badgeId, reqId);
  await prisma.badgeRequirement.delete({ where: { id: reqId } });
};

export const getBadgeVendors = async (badgeId: string, query: PaginationQuery) => {
  await getBadgeById(badgeId);
  const { page, limit, skip } = parsePagination(query);

  const [vendorBadges, total] = await Promise.all([
    prisma.vendorBadge.findMany({
      where: { badgeId },
      include: { vendor: { select: { id: true, storeName: true, logoUrl: true } } },
      orderBy: [{ state: "desc" }, { current: "desc" }],
      skip,
      take: limit,
    }),
    prisma.vendorBadge.count({ where: { badgeId } }),
  ]);

  return { vendorBadges, meta: buildMeta(total, page, limit) };
};
