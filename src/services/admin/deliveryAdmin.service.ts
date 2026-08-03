// src/services/admin/deliveryAdmin.service.ts
import { DeliveryStatus } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";

export interface ListDeliveriesQuery extends PaginationQuery {
  status?: DeliveryStatus;
  riderId?: string;
  from?: string;
  to?: string;
}

export const listDeliveries = async (query: ListDeliveriesQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.status && { status: query.status }),
    ...(query.riderId && { riderId: query.riderId }),
    ...((query.from || query.to) && {
      createdAt: {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      },
    }),
  };

  const [deliveries, total] = await Promise.all([
    prisma.delivery.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        rider: { select: { id: true, user: { select: { fullName: true, phone: true } } } },
        order: { select: { id: true, orderId: true, deliveryAddress: true, vendor: { select: { storeName: true } } } },
      },
    }),
    prisma.delivery.count({ where }),
  ]);

  return { deliveries, meta: buildMeta(total, page, limit) };
};

export const getDeliveryDetail = async (id: string) => {
  const delivery = await prisma.delivery.findUnique({
    where: { id },
    include: {
      rider: { select: { id: true, user: { select: { fullName: true, phone: true } } } },
      order: {
        select: {
          id: true,
          orderId: true,
          deliveryAddress: true,
          status: true,
          vendor: { select: { storeName: true, address: true } },
          user: { select: { fullName: true, phone: true } },
        },
      },
    },
  });
  if (!delivery) throw AppError.notFound("Delivery");

  // Summary, not the raw ping stream — start/end + count is enough for
  // admin inspection without dumping thousands of location rows.
  const locationSummary = await prisma.riderLocationLog.aggregate({
    where: { riderId: delivery.riderId, createdAt: { gte: delivery.createdAt } },
    _count: true,
  });

  return { ...delivery, locationPingCount: locationSummary._count };
};
