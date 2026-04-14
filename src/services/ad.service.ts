// src/services/ad.service.ts
import { Role } from "@prisma/client";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";

export const getStartupAd = async (role: Role) => {
  const ad = await prisma.advertisement.findFirst({
    where: { isActive: true, OR: [{ targetRole: role }, { targetRole: null }] },
    orderBy: { createdAt: "desc" },
  });
  if (!ad) throw AppError.notFound("Ad");
  return ad;
};

export const trackAdEvent = async (data: {
  adId: string;
  event: "view" | "click" | "skip" | "complete";
  durationViewed: number;
}) => {
  await prisma.adEvent.create({
    data: {
      adId: data.adId,
      event: data.event,
      durationViewed: data.durationViewed,
    },
  });
  return { success: true };
};
