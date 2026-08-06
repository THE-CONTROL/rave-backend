// src/services/admin/riderAdmin.service.ts
import { RiderStatus } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";
import { notifyRiderStatusChanged } from "../../events/notification.events";

export interface ListRidersQuery extends PaginationQuery {
  status?: RiderStatus;
  search?: string;
}

export const listRiders = async (query: ListRidersQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.status && { status: query.status }),
    ...(query.search && {
      user: {
        OR: [
          { fullName: { contains: query.search, mode: "insensitive" as const } },
          { email: { contains: query.search, mode: "insensitive" as const } },
        ],
      },
    }),
  };

  const [riders, total] = await Promise.all([
    prisma.riderProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, isActive: true, imageUrl: true } },
      },
    }),
    prisma.riderProfile.count({ where }),
  ]);

  return { riders, meta: buildMeta(total, page, limit) };
};

export const getRiderDetail = async (riderId: string) => {
  const rider = await prisma.riderProfile.findUnique({
    where: { id: riderId },
    include: {
      user: {
        select: { id: true, fullName: true, email: true, phone: true, isActive: true, imageUrl: true, createdAt: true },
      },
      bankAccounts: true,
      sessions: { orderBy: { startedAt: "desc" }, take: 20 },
      locationHistory: { orderBy: { createdAt: "desc" }, take: 20 },
      _count: { select: { deliveries: true } },
    },
  });
  if (!rider) throw AppError.notFound("Rider");
  return rider;
};

const _requireRider = async (riderId: string) => {
  const rider = await prisma.riderProfile.findUnique({
    where: { id: riderId },
    include: { user: { select: { id: true } } },
  });
  if (!rider) throw AppError.notFound("Rider");
  return rider;
};

export const verifyRider = async (riderId: string) => {
  const rider = await _requireRider(riderId);
  if (!["pending", "not_verified"].includes(rider.status)) {
    throw AppError.badRequest("Rider is not awaiting verification.");
  }

  const updated = await prisma.riderProfile.update({
    where: { id: riderId },
    data: {
      status: "verified",
      bikeRejectionReason: null,
      plateRejectionReason: null,
      idRejectionReason: null,
      selfieRejectionReason: null,
      residenceRejectionReason: null,
    },
  });

  await notifyRiderStatusChanged(rider.user.id, "verified").catch(() => {});
  return updated;
};

export type RejectableField = "bike" | "plate" | "id" | "selfie" | "residence";

export const rejectRider = async (
  riderId: string,
  field: RejectableField,
  reason: string,
) => {
  const rider = await _requireRider(riderId);

  const reasonField =
    field === "bike"
      ? { bikeRejectionReason: reason }
      : field === "plate"
        ? { plateRejectionReason: reason }
        : field === "id"
          ? { idRejectionReason: reason }
          : field === "selfie"
            ? { selfieRejectionReason: reason }
            : { residenceRejectionReason: reason };

  const updated = await prisma.riderProfile.update({
    where: { id: riderId },
    data: { status: "not_verified", ...reasonField },
  });

  await notifyRiderStatusChanged(rider.user.id, "not_verified", reason).catch(() => {});
  return updated;
};

export const suspendRider = async (riderId: string, reason?: string) => {
  const rider = await _requireRider(riderId);
  if (rider.status !== "verified") {
    throw AppError.badRequest("Only a verified rider can be suspended.");
  }

  const updated = await prisma.riderProfile.update({
    where: { id: riderId },
    data: { status: "suspended", isOnline: false },
  });

  await notifyRiderStatusChanged(rider.user.id, "suspended", reason).catch(() => {});
  return updated;
};

export const reactivateRider = async (riderId: string) => {
  const rider = await _requireRider(riderId);
  if (rider.status !== "suspended") {
    throw AppError.badRequest("Only a suspended rider can be reactivated.");
  }

  const updated = await prisma.riderProfile.update({
    where: { id: riderId },
    data: { status: "verified" },
  });

  await notifyRiderStatusChanged(rider.user.id, "verified").catch(() => {});
  return updated;
};
