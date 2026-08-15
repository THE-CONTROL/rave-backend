// src/services/admin/vendorAdmin.service.ts
import { StoreStatus } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta, maskAccountNumber } from "../../utils";
import { notifyVendorStatusChanged } from "../../events/notification.events";
import { decrypt } from "../../utils/crypto";

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
        user: { select: { id: true, fullName: true, email: true, phone: true, isActive: true, imageUrl: true } },
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
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          isActive: true,
          imageUrl: true,
          createdAt: true,
          notificationSettings: true,
        },
      },
      schedules: true,
      bankAccounts: true,
      badges: { include: { badge: true } },
      // Categories/option groups are the vendor's own small, bounded lists
      // (unlike orders/menu items/promotions/reviews, which can grow
      // unbounded and are surfaced as "view all" links to the existing
      // filtered admin list pages instead of embedding here).
      categories: { orderBy: { name: "asc" } },
      optionGroups: {
        include: {
          options: { include: { sizes: true } },
          menuItems: { select: { id: true, name: true } },
        },
      },
      _count: { select: { ordersReceived: true, menuItems: true, promotions: true, reviewsReceived: true } },
    },
  });
  if (!vendor) throw AppError.notFound("Vendor");

  // Revenue earned from orders, NOT payouts already sent to the vendor's
  // bank (that's `type: "payment"` — see vendor.service.ts's own payout
  // balance calc). This was summing the wrong transaction type, so the
  // admin's "Total Revenue" stat was actually showing payout history.
  const revenue = await prisma.transaction.aggregate({
    where: { vendorId, type: "order", status: "completed" },
    _sum: { amount: true },
  });

  // Mask the account number — bankAccounts.accountNumber is stored encrypted;
  // never send the raw decrypted value (or, worse, raw ciphertext) to a client.
  const bankAccounts = vendor.bankAccounts.map((b) => ({
    ...b,
    accountNumber: maskAccountNumber(decrypt(b.accountNumber)),
  }));

  return { ...vendor, bankAccounts, totalRevenue: revenue._sum.amount ?? 0 };
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
