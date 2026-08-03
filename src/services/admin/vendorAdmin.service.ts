// src/services/admin/vendorAdmin.service.ts
import { StoreStatus } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";
import { notifyVendorStatusChanged } from "../../events/notification.events";

export interface ListVendorsQuery extends PaginationQuery {
  storeStatus?: StoreStatus;
  search?: string;
}

export const listVendors = async (query: ListVendorsQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.storeStatus && { storeStatus: query.storeStatus }),
    ...(query.search && {
      OR: [
        { storeName: { contains: query.search, mode: "insensitive" as const } },
        { user: { email: { contains: query.search, mode: "insensitive" as const } } },
        { user: { fullName: { contains: query.search, mode: "insensitive" as const } } },
      ],
    }),
  };

  const [vendors, total] = await Promise.all([
    prisma.vendorProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, isActive: true } },
      },
    }),
    prisma.vendorProfile.count({ where }),
  ]);

  return { vendors, meta: buildMeta(total, page, limit) };
};

export const getVendorDetail = async (vendorId: string) => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true, isActive: true, createdAt: true } },
      schedules: true,
      bankAccounts: true,
      badges: { include: { badge: true } },
      _count: { select: { ordersReceived: true, menuItems: true, promotions: true } },
    },
  });
  if (!vendor) throw AppError.notFound("Vendor");

  const revenue = await prisma.transaction.aggregate({
    where: { vendorId, type: "payment", status: "completed" },
    _sum: { amount: true },
  });

  return { ...vendor, totalRevenue: revenue._sum.amount ?? 0 };
};

const _requireVendor = async (vendorId: string) => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    include: { user: { select: { id: true } } },
  });
  if (!vendor) throw AppError.notFound("Vendor");
  return vendor;
};

export const approveVendor = async (vendorId: string) => {
  const vendor = await _requireVendor(vendorId);
  if (vendor.storeStatus !== "under_review") {
    throw AppError.badRequest("Vendor is not pending review.");
  }

  const updated = await prisma.vendorProfile.update({
    where: { id: vendorId },
    data: { storeStatus: "open", storeStatusReason: null },
  });

  await notifyVendorStatusChanged(vendor.user.id, "open").catch(() => {});
  return updated;
};

export const denyVendor = async (vendorId: string, reason: string) => {
  const vendor = await _requireVendor(vendorId);
  if (vendor.storeStatus !== "under_review") {
    throw AppError.badRequest("Vendor is not pending review.");
  }

  const updated = await prisma.vendorProfile.update({
    where: { id: vendorId },
    data: { storeStatus: "denied", storeStatusReason: reason },
  });

  await notifyVendorStatusChanged(vendor.user.id, "denied", reason).catch(() => {});
  return updated;
};

export const suspendVendor = async (vendorId: string, reason?: string) => {
  const vendor = await _requireVendor(vendorId);
  if (!["open", "paused"].includes(vendor.storeStatus)) {
    throw AppError.badRequest("Only an open or paused store can be suspended.");
  }

  const updated = await prisma.vendorProfile.update({
    where: { id: vendorId },
    data: { storeStatus: "deactivated", isOpen: false, storeStatusReason: reason ?? null },
  });

  await notifyVendorStatusChanged(vendor.user.id, "deactivated", reason).catch(() => {});
  return updated;
};

export const reactivateVendor = async (vendorId: string) => {
  const vendor = await _requireVendor(vendorId);
  if (!["deactivated", "paused"].includes(vendor.storeStatus)) {
    throw AppError.badRequest("Only a deactivated or paused store can be reactivated.");
  }

  const updated = await prisma.vendorProfile.update({
    where: { id: vendorId },
    data: { storeStatus: "open", storeStatusReason: null },
  });

  await notifyVendorStatusChanged(vendor.user.id, "open").catch(() => {});
  return updated;
};
