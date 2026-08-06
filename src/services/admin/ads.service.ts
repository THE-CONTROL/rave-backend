// src/services/admin/ads.service.ts
import { AdMediaType, Role } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";

export interface ListAdsQuery extends PaginationQuery {
  targetRole?: Role;
  isActive?: boolean;
}

export const listAds = async (query: ListAdsQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.targetRole && { targetRole: query.targetRole }),
    ...(query.isActive !== undefined && { isActive: query.isActive }),
  };

  const [ads, total] = await Promise.all([
    prisma.advertisement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { _count: { select: { adEvents: true } } },
    }),
    prisma.advertisement.count({ where }),
  ]);

  return { ads, meta: buildMeta(total, page, limit) };
};

export const getAdById = async (id: string) => {
  const ad = await prisma.advertisement.findUnique({
    where: { id },
    include: { _count: { select: { adEvents: true } } },
  });
  if (!ad) throw AppError.notFound("Advertisement");
  return ad;
};

export interface CreateAdDto {
  type: AdMediaType;
  contentUri?: string;
  headline?: string;
  bodyText?: string;
  ctaText?: string;
  ctaUrl?: string;
  duration?: number;
  targetRole?: Role;
  isActive?: boolean;
}

export const createAd = (data: CreateAdDto) => prisma.advertisement.create({ data });

export const updateAd = async (id: string, data: Partial<CreateAdDto>) => {
  const existing = await prisma.advertisement.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Advertisement");
  return prisma.advertisement.update({ where: { id }, data });
};

export const deleteAd = async (id: string) => {
  const existing = await prisma.advertisement.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Advertisement");
  await prisma.advertisement.delete({ where: { id } });
};

export const getAdStats = async (id: string) => {
  const ad = await prisma.advertisement.findUnique({ where: { id } });
  if (!ad) throw AppError.notFound("Advertisement");

  const [breakdown, recentEvents] = await Promise.all([
    prisma.adEvent.groupBy({
      by: ["event"],
      where: { adId: id },
      _count: true,
      _avg: { durationViewed: true },
    }),
    prisma.adEvent.findMany({
      where: { adId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return {
    adId: id,
    breakdown: breakdown.map((b) => ({
      event: b.event,
      count: b._count,
      avgDurationViewed: b._avg.durationViewed ?? 0,
    })),
    recentEvents,
  };
};
