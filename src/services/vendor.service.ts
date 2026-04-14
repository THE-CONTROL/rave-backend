// src/services/vendor.service.ts
import bcrypt from "bcryptjs";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { buildMeta, maskAccountNumber, parsePagination } from "../utils";
import { PaginationQuery } from "../types";
import { VendorNotificationSettingsPayload } from "../types/notifications";
import { cfg } from "./config.service";

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorProfile = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      accountId: true,
      fullName: true,
      email: true,
      phone: true,
      imageUrl: true,
      joinedDate: true,
      vendorProfile: {
        select: {
          id: true,
          storeName: true,
          storeStatus: true,
          isOpen: true,
          autoAcceptOrders: true,
          address: true,
          description: true,
          bannerUrl: true,
          logoUrl: true,
          hoursSummary: true,
          averageRating: true,
          totalReviews: true,
        },
      },
    },
  });
  if (!user) throw AppError.notFound("User");
  return user;
};

export const updateVendorProfile = async (
  userId: string,
  data: { fullName?: string; phone?: string; imageUrl?: string },
) =>
  prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, fullName: true, phone: true, imageUrl: true },
  });

export const changeVendorPassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw AppError.notFound("User");
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw AppError.badRequest("Current password is incorrect.");
  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hash },
  });
};

export const deleteVendorAccount = async (userId: string): Promise<void> => {
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false, email: `deleted_vendor_${userId}@rave.com` },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export const getDashboard = async (userId: string) => {
  const vendor = await _requireVendor(userId);

  const [
    totalOrders,
    completedOrders,
    totalRevenueTx,
    todayOrders,
    preparingCount,
    readyCount,
    ongoingCount,
  ] = await Promise.all([
    prisma.order.count({ where: { vendorId: vendor.id } }),
    prisma.order.count({ where: { vendorId: vendor.id, status: "completed" } }),
    prisma.vendorTransaction.aggregate({
      where: { vendorId: vendor.id, type: "payment" },
      _sum: { amount: true },
    }),
    prisma.order.count({
      where: {
        vendorId: vendor.id,
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
    prisma.order.count({ where: { vendorId: vendor.id, status: "preparing" } }),
    prisma.order.count({ where: { vendorId: vendor.id, status: "ready" } }),
    prisma.order.count({ where: { vendorId: vendor.id, status: "ongoing" } }),
  ]);

  const totalRevenue = totalRevenueTx._sum.amount ?? 0;
  const completionRate =
    totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;

  // Reuse getVendorOnboardingState so step logic stays in one place
  const onboardingState = await getVendorOnboardingState(userId);

  const STEP_DEFS = [
    { key: "basic", label: "Store Identity & Location" },
    { key: "branding", label: "Brand Visuals" },
    { key: "bank", label: "Payout Destination" },
    { key: "schedule", label: "Opening Hours" },
  ];

  const { step1Done, step2Done, step3Done, step4Done } =
    onboardingState.stepsComplete;
  const stepFlags = [step1Done, step2Done, step3Done, step4Done];

  return {
    isStoreOpen: vendor.isOpen,
    storeLogoUrl: vendor.logoUrl,
    storeName: vendor.storeName,
    storeStatus: vendor.storeStatus,
    onboarding: {
      complete: stepFlags.every(Boolean),
      setupProgress: onboardingState.setupProgress,
      resumeStep: onboardingState.resumeStep,
      stepsComplete: onboardingState.stepsComplete,
      steps: STEP_DEFS.map((s, i) => ({
        key: s.key,
        label: s.label,
        completed: stepFlags[i] ?? false,
      })),
    },
    stats: {
      todayOrders,
      preparing: preparingCount,
      ready: readyCount,
      inTransit: ongoingCount,
      totalOrders,
      totalRevenue,
      completedOrders,
      completionRate,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Store Settings
// ─────────────────────────────────────────────────────────────────────────────

export const getStoreSettings = async (userId: string) => {
  const vendor = await _requireVendor(userId);
  const menuCount = await prisma.menuItem.count({
    where: { vendorId: vendor.id },
  });
  const promoCount = await prisma.promotion.count({
    where: { vendorId: vendor.id },
  });
  return {
    ...vendor,
    menuitemsNumber: menuCount,
    promotionsNumber: promoCount,
  };
};

export const updateStoreSettings = async (
  userId: string,
  data: {
    storeName?: string;
    address?: string;
    description?: string;
    isOpen?: boolean;
    autoAcceptOrders?: boolean;
    hoursSummary?: string;
    bannerUrl?: string;
    logoUrl?: string;
  },
) => {
  const vendor = await _requireVendor(userId);
  return prisma.vendorProfile.update({
    where: { id: vendor.id },
    data,
  });
};

export const toggleStoreOpen = async (
  userId: string,
): Promise<{ isOpen: boolean }> => {
  const vendor = await _requireVendor(userId);
  const updated = await prisma.vendorProfile.update({
    where: { id: vendor.id },
    data: { isOpen: !vendor.isOpen },
    select: { isOpen: true },
  });
  return updated;
};

export const getStoreSchedules = async (userId: string) => {
  const vendor = await _requireVendor(userId);
  return prisma.storeSchedule.findMany({ where: { vendorId: vendor.id } });
};

export const upsertStoreSchedules = async (
  userId: string,
  schedules: { day: string; openTime: string; closeTime: string }[],
): Promise<void> => {
  const vendor = await _requireVendor(userId);
  await prisma.$transaction(
    schedules.map((s) =>
      prisma.storeSchedule.upsert({
        where: { vendorId_day: { vendorId: vendor.id, day: s.day } },
        create: { vendorId: vendor.id, ...s },
        update: { openTime: s.openTime, closeTime: s.closeTime },
      }),
    ),
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────────────────────

export const getCategories = async (userId: string) => {
  const vendor = await _requireVendor(userId);
  return prisma.category.findMany({
    where: { vendorId: vendor.id },
    include: { _count: { select: { menuItems: true } } },
    orderBy: { createdAt: "asc" },
  });
};

export const getCategoryById = async (userId: string, categoryId: string) => {
  const vendor = await _requireVendor(userId);
  const category = await prisma.category.findFirst({
    where: { id: categoryId, vendorId: vendor.id },
    include: { menuItems: { include: { menuItem: true } } },
  });
  if (!category) throw AppError.notFound("Category");
  return category;
};

export const createCategory = async (
  userId: string,
  data: { name: string; description?: string; imageUrl?: string },
) => {
  const vendor = await _requireVendor(userId);
  return prisma.category.create({ data: { vendorId: vendor.id, ...data } });
};

export const updateCategory = async (
  userId: string,
  categoryId: string,
  data: { name?: string; description?: string; isActive?: boolean },
) => {
  const vendor = await _requireVendor(userId);
  const existing = await prisma.category.findFirst({
    where: { id: categoryId, vendorId: vendor.id },
  });
  if (!existing) throw AppError.notFound("Category");
  return prisma.category.update({ where: { id: categoryId }, data });
};

export const deleteCategories = async (
  userId: string,
  ids: string[],
): Promise<void> => {
  const vendor = await _requireVendor(userId);
  await prisma.category.deleteMany({
    where: { id: { in: ids }, vendorId: vendor.id },
  });
};

export const addItemsToCategory = async (
  userId: string,
  categoryId: string,
  itemIds: string[],
): Promise<void> => {
  const vendor = await _requireVendor(userId);
  const category = await prisma.category.findFirst({
    where: { id: categoryId, vendorId: vendor.id },
  });
  if (!category) throw AppError.notFound("Category");

  await prisma.menuItemCategory.createMany({
    data: itemIds.map((menuItemId) => ({ menuItemId, categoryId })),
    skipDuplicates: true,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Menu Items
// ─────────────────────────────────────────────────────────────────────────────

export const getMenuItems = async (
  userId: string,
  query: PaginationQuery & {
    filter?: string;
    categoryId?: string;
    isBestSeller?: string;
  },
) => {
  const vendor = await _requireVendor(userId);
  const { page, limit, skip } = parsePagination(query);

  const where = {
    vendorId: vendor.id,
    ...(query.filter && query.filter !== "all"
      ? { isActive: query.filter === "active" }
      : {}),
    ...(query.categoryId
      ? { categories: { some: { categoryId: query.categoryId } } }
      : {}),
    ...(query.isBestSeller === "true" ? { isBestSeller: true } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.menuItem.findMany({
      where,
      include: { categories: { include: { category: true } } },
      orderBy: [{ isBestSeller: "desc" }, { createdAt: "desc" }],
      skip,
      take: limit,
    }),
    prisma.menuItem.count({ where }),
  ]);

  return { items, meta: buildMeta(total, page, limit) };
};

export const getMenuItemById = async (userId: string, itemId: string) => {
  const vendor = await _requireVendor(userId);

  const [item, reviews] = await Promise.all([
    prisma.menuItem.findFirst({
      where: { id: itemId, vendorId: vendor.id },
      include: {
        categories: { include: { category: true } },
        customGroups: { include: { options: true } },
      },
    }),
    prisma.review.findMany({
      where: { menuItemIds: { has: itemId } },
      include: { user: { select: { fullName: true, imageUrl: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  if (!item) throw AppError.notFound("Menu item");

  return { ...item, reviews };
};

export const createMenuItem = async (
  userId: string,
  data: {
    name: string;
    description?: string;
    price: number;
    imageUrl?: string;
    calories?: string;
    prepTime?: string;
    serves?: string;
    categoryIds?: string[];
  },
) => {
  const vendor = await _requireVendor(userId);
  const { categoryIds, ...itemData } = data;

  return prisma.menuItem.create({
    data: {
      vendorId: vendor.id,
      ...itemData,
      ...(categoryIds?.length
        ? {
            categories: {
              create: categoryIds.map((categoryId) => ({ categoryId })),
            },
          }
        : {}),
    },
    include: { categories: { include: { category: true } } },
  });
};

export const updateMenuItem = async (
  userId: string,
  itemId: string,
  data: {
    name?: string;
    description?: string;
    price?: number;
    imageUrl?: string;
    isActive?: boolean;
    isBestSeller?: boolean;
  },
) => {
  const vendor = await _requireVendor(userId);
  const existing = await prisma.menuItem.findFirst({
    where: { id: itemId, vendorId: vendor.id },
  });
  if (!existing) throw AppError.notFound("Menu item");
  return prisma.menuItem.update({ where: { id: itemId }, data });
};

export const deleteMenuItems = async (
  userId: string,
  ids: string[],
): Promise<void> => {
  const vendor = await _requireVendor(userId);
  await prisma.menuItem.deleteMany({
    where: { id: { in: ids }, vendorId: vendor.id },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Orders (Vendor side)
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorOrders = async (
  userId: string,
  tab: string,
  query: PaginationQuery,
) => {
  const vendor = await _requireVendor(userId);
  const { page, limit, skip } = parsePagination(query);

  const statusMap: Record<string, string[]> = {
    active: ["new", "accepted", "preparing", "ready", "ongoing"],
    completed: ["completed"],
    cancelled: ["cancelled"],
  };

  const statusFilter = statusMap[tab] ?? statusMap.active;

  const where = {
    vendorId: vendor.id,
    status: {
      in: statusFilter as (
        | "new"
        | "accepted"
        | "preparing"
        | "ready"
        | "ongoing"
        | "completed"
        | "cancelled"
      )[],
    },
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
        user: { select: { fullName: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, meta: buildMeta(total, page, limit) };
};

export const getVendorOrderById = async (userId: string, orderId: string) => {
  const vendor = await _requireVendor(userId);
  const order = await prisma.order.findFirst({
    where: { id: orderId, vendorId: vendor.id },
    include: {
      items: { include: { menuItem: true } },
      user: { select: { fullName: true, phone: true } },
      delivery: {
        include: {
          rider: {
            select: {
              currentLat: true,
              currentLng: true,
              user: { select: { fullName: true, phone: true } },
            },
          },
        },
      },
    },
  });
  if (!order) throw AppError.notFound("Order");

  const rider = order.delivery?.rider;

  return {
    ...order,
    deliveryInstructions: order.deliveryInstructions,
    contactMethod: order.contactMethod ?? "in-app",
    deliveryLat: order.deliveryLat,
    deliveryLng: order.deliveryLng,
    rider: rider
      ? {
          name: order.riderName ?? rider.user?.fullName ?? "",
          phone: order.riderPhone ?? rider.user?.phone ?? "",
          code: order.riderCode ?? null,
          lat: rider.currentLat,
          lng: rider.currentLng,
        }
      : null,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

export const getAnalytics = async (userId: string) => {
  const vendor = await _requireVendor(userId);

  const [totalTx, totalOrders, completedOrders, cancelledOrders] =
    await Promise.all([
      prisma.vendorTransaction.aggregate({
        where: { vendorId: vendor.id, type: "payment" },
        _sum: { amount: true },
        _avg: { amount: true },
      }),
      prisma.order.count({ where: { vendorId: vendor.id } }),
      prisma.order.count({
        where: { vendorId: vendor.id, status: "completed" },
      }),
      prisma.order.count({
        where: { vendorId: vendor.id, status: "cancelled" },
      }),
    ]);

  const totalRevenue = totalTx._sum.amount ?? 0;
  const averageOrderValue = Math.round(totalTx._avg.amount ?? 0);

  return {
    totalRevenue,
    averageOrderValue,
    totalOrders,
    completedOrders,
    completionRate:
      totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0,
    cancelledOrders,
    cancellationRate:
      totalOrders > 0 ? Math.round((cancelledOrders / totalOrders) * 100) : 0,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Transactions / Earnings
// ─────────────────────────────────────────────────────────────────────────────

const formatVendorTx = (tx: any) => {
  const isCredit = tx.type === "payment";
  const absAmount = Math.abs(tx.amount);
  return {
    id: tx.id,
    type: tx.type,
    category: tx.category,
    title: tx.title,
    status: tx.status,
    reference: tx.reference ?? null,
    amount: tx.amount,
    formattedAmount: `${isCredit ? "+" : "-"}₦${absAmount.toLocaleString()}`,
    icon: isCredit ? "bag-outline" : "arrow-up-circle-outline",
    iconBg: isCredit ? "#34C759" : "#FF3B30",
    date: tx.createdAt.toISOString(),
    formattedDate: new Date(tx.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    formattedTime: new Date(tx.createdAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
};

export const getEarningsSummary = async (userId: string) => {
  const vendor = await _requireVendor(userId);

  const [earned, withdrawn, pending, recentTxs, commissionRate] =
    await Promise.all([
      prisma.vendorTransaction.aggregate({
        where: { vendorId: vendor.id, type: "payment", status: "completed" },
        _sum: { amount: true },
      }),
      prisma.vendorTransaction.aggregate({
        where: { vendorId: vendor.id, type: "withdrawal", status: "completed" },
        _sum: { amount: true },
      }),
      prisma.vendorTransaction.aggregate({
        where: { vendorId: vendor.id, type: "withdrawal", status: "pending" },
        _sum: { amount: true },
      }),
      prisma.vendorTransaction.findMany({
        where: { vendorId: vendor.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      cfg.fees.vendorCommission(),
    ]);

  const totalEarned = earned._sum.amount ?? 0;
  const totalWithdrawn = withdrawn._sum.amount ?? 0;
  const pendingPayout = pending._sum.amount ?? 0;
  const available = Math.max(0, totalEarned - totalWithdrawn - pendingPayout);

  return {
    totalEarned,
    totalWithdrawn,
    availableBalance: available,
    pendingBalance: pendingPayout,
    commissionRate, // e.g. 0.10 — platform takes 10% of each order
    recentTransactions: recentTxs.map(formatVendorTx),
  };
};

export const getVendorTransactions = async (
  userId: string,
  query: PaginationQuery & { type?: string },
) => {
  const vendor = await _requireVendor(userId);
  const { page, limit, skip } = parsePagination(query);

  const validTypes = ["payment", "withdrawal"];
  const typeFilter =
    query.type && query.type !== "all" && validTypes.includes(query.type)
      ? (query.type as any)
      : undefined;

  const where = {
    vendorId: vendor.id,
    ...(typeFilter ? { type: typeFilter } : {}),
  };

  const [transactions, total] = await Promise.all([
    prisma.vendorTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.vendorTransaction.count({ where }),
  ]);

  return { transactions, meta: buildMeta(total, page, limit) };
};

export const getVendorTransactionById = async (
  userId: string,
  txId: string,
) => {
  const vendor = await _requireVendor(userId);
  const tx = await prisma.vendorTransaction.findFirst({
    where: { id: txId, vendorId: vendor.id },
  });
  if (!tx) throw AppError.notFound("Transaction");
  return tx;
};

export const requestPayout = async (
  userId: string,
  amount: number,
  bankId: string,
): Promise<{ success: boolean }> => {
  const vendor = await _requireVendor(userId);
  const summary = await getEarningsSummary(userId);

  if (summary.availableBalance < amount) {
    throw AppError.badRequest("Insufficient available balance.");
  }

  const bank = await prisma.vendorBankAccount.findFirst({
    where: { id: bankId, vendorId: vendor.id },
  });
  if (!bank) throw AppError.notFound("Bank account");

  await prisma.vendorTransaction.create({
    data: {
      vendorId: vendor.id,
      type: "withdrawal",
      category: "payout",
      title: `Bank Transfer - ${bank.bank}`,
      amount,
      status: "completed",
    },
  });

  return { success: true };
};

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Onboarding — per-step save + resume
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorOnboardingState = async (userId: string) => {
  const vendor = await _requireVendor(userId);

  const [bank, schedules] = await Promise.all([
    prisma.vendorBankAccount.findFirst({
      where: { vendorId: vendor.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.storeSchedule.findMany({ where: { vendorId: vendor.id } }),
  ]);

  const step1Done = !!(vendor.storeName && vendor.address);
  const step2Done = !!vendor.logoUrl;
  const step3Done = !!bank;
  const step4Done = schedules.length > 0;

  let resumeStep = 1;
  if (!step1Done) resumeStep = 1;
  else if (!step2Done) resumeStep = 2;
  else if (!step3Done) resumeStep = 3;
  else if (!step4Done) resumeStep = 4;
  else resumeStep = 5; // all done → review

  const doneCount = [step1Done, step2Done, step3Done, step4Done].filter(
    Boolean,
  ).length;
  const setupProgress = Math.round((doneCount / 4) * 100);

  return {
    resumeStep,
    setupProgress,
    stepsComplete: { step1Done, step2Done, step3Done, step4Done },
    storeName: vendor.storeName,
    address: vendor.address ?? null,
    description: vendor.description ?? null,
    logoUrl: vendor.logoUrl ?? null,
    bannerUrl: vendor.bannerUrl ?? null,
    documentType: (vendor as any).documentType ?? null,
    documentUrl: (vendor as any).documentUrl ?? null,
    storeStatus: vendor.storeStatus,
    schedules: schedules.map((s) => ({
      day: s.day,
      openTime: s.openTime,
      closeTime: s.closeTime,
    })),
    bank: bank
      ? { bank: bank.bank, accountNumber: bank.accountNumber, name: bank.name }
      : null,
  };
};

export const saveVendorOnboardingStep = async (
  userId: string,
  step: number,
  data: Record<string, unknown>,
): Promise<{ setupProgress: number }> => {
  const vendor = await _requireVendor(userId);

  const ALLOWED: Record<number, string[]> = {
    1: ["storeName", "address", "description", "lat", "lng"],
    2: ["logoUrl", "bannerUrl"],
  };

  if (step === 3) {
    // Save bank account — upsert so re-submitting the same step doesn't duplicate
    const { bank, name, accountNumber, bankCode } = data as any;
    if (bank && name && accountNumber) {
      const existing = await prisma.vendorBankAccount.findFirst({
        where: { vendorId: vendor.id },
      });
      if (existing) {
        await prisma.vendorBankAccount.update({
          where: { id: existing.id },
          data: {
            bank,
            name,
            accountNumber,
            bankCode: bankCode ?? existing.bankCode,
          },
        });
      } else {
        await prisma.vendorBankAccount.create({
          data: {
            vendorId: vendor.id,
            isPrimary: true,
            bank,
            name,
            accountNumber,
            bankCode,
          },
        });
      }
    }
  } else if (step === 4) {
    // Save store schedules
    const schedules =
      (data.schedules as {
        day: string;
        openTime: string;
        closeTime: string;
      }[]) ?? [];
    if (schedules.length > 0) {
      await prisma.$transaction(
        schedules.map((s) =>
          prisma.storeSchedule.upsert({
            where: { vendorId_day: { vendorId: vendor.id, day: s.day } },
            create: {
              vendorId: vendor.id,
              day: s.day,
              openTime: s.openTime,
              closeTime: s.closeTime,
            },
            update: { openTime: s.openTime, closeTime: s.closeTime },
          }),
        ),
      );
    }
  } else {
    const allowed = ALLOWED[step] ?? [];
    const safeData = Object.fromEntries(
      Object.entries(data).filter(([k]) => allowed.includes(k)),
    );
    if (Object.keys(safeData).length > 0) {
      await prisma.vendorProfile.update({
        where: { id: vendor.id },
        data: safeData as any,
      });
    }
  }

  // Recalculate progress across all 4 steps
  const [updated, scheduleCount] = await Promise.all([
    prisma.vendorProfile.findUnique({
      where: { id: vendor.id },
      include: { vendorBankAccounts: true },
    }),
    prisma.storeSchedule.count({ where: { vendorId: vendor.id } }),
  ]);

  const doneCount = [
    !!(updated?.storeName && updated?.address),
    !!updated?.logoUrl,
    (updated?.vendorBankAccounts.length ?? 0) > 0,
    scheduleCount > 0,
  ].filter(Boolean).length;

  const setupProgress = Math.round((doneCount / 4) * 100);

  await prisma.vendorProfile.update({
    where: { id: vendor.id },
    data: { setupProgress } as any,
  });

  return { setupProgress };
};

export const submitVendorOnboarding = async (
  userId: string,
): Promise<{ success: boolean }> => {
  const state = await getVendorOnboardingState(userId);
  const { step1Done, step2Done, step3Done, step4Done } = state.stepsComplete;

  if (!step1Done || !step2Done || !step3Done || !step4Done)
    throw AppError.badRequest("Please complete all steps before submitting.");

  const vendor = await _requireVendor(userId);
  await prisma.vendorProfile.update({
    where: { id: vendor.id },
    data: { setupProgress: 100 } as any,
  });

  return { success: true };
};

// ─────────────────────────────────────────────────────────────────────────────
// Bank Accounts
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorBankAccounts = async (userId: string) => {
  const vendor = await _requireVendor(userId);
  const accounts = await prisma.vendorBankAccount.findMany({
    where: { vendorId: vendor.id },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return accounts.map((a) => ({
    ...a,
    maskedNumber: maskAccountNumber(a.accountNumber),
  }));
};

export const saveVendorBankAccount = async (
  userId: string,
  data: {
    bank: string;
    name: string;
    accountNumber: string;
    bankCode?: string;
  },
): Promise<void> => {
  const vendor = await _requireVendor(userId);
  const count = await prisma.vendorBankAccount.count({
    where: { vendorId: vendor.id },
  });
  await prisma.vendorBankAccount.create({
    data: { vendorId: vendor.id, isPrimary: count === 0, ...data },
  });
};

export const setVendorPrimaryBank = async (
  userId: string,
  bankId: string,
): Promise<void> => {
  const vendor = await _requireVendor(userId);
  await prisma.$transaction([
    prisma.vendorBankAccount.updateMany({
      where: { vendorId: vendor.id },
      data: { isPrimary: false },
    }),
    prisma.vendorBankAccount.update({
      where: { id: bankId },
      data: { isPrimary: true },
    }),
  ]);
};

export const deleteVendorBankAccount = async (
  userId: string,
  bankId: string,
): Promise<void> => {
  const vendor = await _requireVendor(userId);
  const account = await prisma.vendorBankAccount.findFirst({
    where: { id: bankId, vendorId: vendor.id },
  });
  if (!account) throw AppError.notFound("Bank account");
  await prisma.vendorBankAccount.delete({ where: { id: bankId } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Promotions
// ─────────────────────────────────────────────────────────────────────────────

export const getPromotions = async (userId: string, status?: string) => {
  const vendor = await _requireVendor(userId);
  const now = new Date();
  const where = {
    vendorId: vendor.id,
    ...(status === "active" ? { isActive: true, endDate: { gte: now } } : {}),
    ...(status === "expired"
      ? { OR: [{ isActive: false }, { endDate: { lt: now } }] }
      : {}),
  };
  return prisma.promotion.findMany({ where, orderBy: { createdAt: "desc" } });
};

export const getPromotionById = async (userId: string, promoId: string) => {
  const vendor = await _requireVendor(userId);
  const promo = await prisma.promotion.findFirst({
    where: { id: promoId, vendorId: vendor.id },
  });
  if (!promo) throw AppError.notFound("Promotion");
  return promo;
};

export const createPromotion = async (
  userId: string,
  data: {
    title: string;
    subtitle?: string;
    type: string;
    startDate: Date;
    endDate: Date;
    description?: string;
    discountValue?: number;
    promoCode?: string;
    minimumOrder?: number;
  },
) => {
  const vendor = await _requireVendor(userId);
  return prisma.promotion.create({ data: { vendorId: vendor.id, ...data } });
};

export const updatePromotion = async (
  userId: string,
  promoId: string,
  data: Partial<{
    title: string;
    subtitle: string;
    type: string;
    startDate: Date | string;
    endDate: Date | string;
    description: string;
    isActive: boolean;
    discountValue: number;
    promoCode: string;
    minimumOrder: number;
    maxUses: number;
  }>,
) => {
  const vendor = await _requireVendor(userId);
  const existing = await prisma.promotion.findFirst({
    where: { id: promoId, vendorId: vendor.id },
  });
  if (!existing) throw AppError.notFound("Promotion");
  return prisma.promotion.update({ where: { id: promoId }, data });
};

export const deletePromotion = async (
  userId: string,
  promoId: string,
): Promise<void> => {
  const vendor = await _requireVendor(userId);
  const existing = await prisma.promotion.findFirst({
    where: { id: promoId, vendorId: vendor.id },
  });
  if (!existing) throw AppError.notFound("Promotion");
  await prisma.promotion.delete({ where: { id: promoId } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Reviews
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorRatingStats = async (userId: string) => {
  const vendor = await _requireVendor(userId);
  const reviews = await prisma.review.findMany({
    where: { vendorId: vendor.id },
    select: { restaurantRating: true, foodRating: true, riderRating: true },
  });

  if (!reviews.length) {
    return { averageRating: 0, totalReviews: 0, distribution: {} };
  }

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;

  for (const r of reviews) {
    const avg = Math.round(
      (r.restaurantRating + r.foodRating + r.riderRating) / 3,
    );
    distribution[avg] = (distribution[avg] ?? 0) + 1;
    total += avg;
  }

  return {
    averageRating: parseFloat((total / reviews.length).toFixed(1)),
    totalReviews: reviews.length,
    distribution,
  };
};

export const getVendorReviews = async (
  userId: string,
  query: PaginationQuery & { rating?: string; hasComment?: string },
) => {
  const vendor = await _requireVendor(userId);
  const { page, limit, skip } = parsePagination(query);

  const where = {
    vendorId: vendor.id,
    ...(query.rating
      ? { restaurantRating: { gte: Number(query.rating) } }
      : {}),
    ...(query.hasComment === "true" ? { comment: { not: null } } : {}),
  };

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where,
      include: { user: { select: { fullName: true, imageUrl: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.review.count({ where }),
  ]);

  return { reviews, meta: buildMeta(total, page, limit) };
};

// ─────────────────────────────────────────────────────────────────────────────
// Badges
// ─────────────────────────────────────────────────────────────────────────────

export const getBadgeStats = async (userId: string) => {
  const vendor = await _requireVendor(userId);
  const [unlocked, inProgress] = await Promise.all([
    prisma.vendorBadge.count({
      where: { vendorId: vendor.id, state: "unlocked" },
    }),
    prisma.vendorBadge.count({
      where: { vendorId: vendor.id, state: "in_progress" },
    }),
  ]);
  return { badgesUnlocked: unlocked, inProgress, rank: "Rising Star" };
};

export const getBadges = async (userId: string) => {
  const vendor = await _requireVendor(userId);
  return prisma.vendorBadge.findMany({
    where: { vendorId: vendor.id },
    include: { badge: { include: { requirements: true } } },
    orderBy: { createdAt: "desc" },
  });
};

export const getBadgeById = async (userId: string, badgeId: string) => {
  const vendor = await _requireVendor(userId);
  const vb = await prisma.vendorBadge.findFirst({
    where: { vendorId: vendor.id, badgeId },
    include: { badge: { include: { requirements: true } } },
  });
  if (!vb) throw AppError.notFound("Badge");
  return vb;
};

// ─────────────────────────────────────────────────────────────────────────────
// Referrals
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorReferralStats = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (!user) throw AppError.notFound("User");

  const referrals = await prisma.referral.findMany({
    where: { referrerId: userId },
    include: { referee: { select: { fullName: true, imageUrl: true } } },
    orderBy: { createdAt: "desc" },
  });

  const earned = await prisma.transaction.aggregate({
    where: { userId, type: "referral_bonus", status: "successful" },
    _sum: { amount: true },
  });

  return {
    referralCode: user.referralCode,
    totalReferrals: referrals.length,
    amountEarned: earned._sum.amount ?? 0,
    recentReferrals: referrals.slice(0, 10),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorNotifications = async (
  userId: string,
  query: { cursor?: string; type?: string; limit?: string },
) => {
  const take = Math.min(Number(query.limit) || 20, 50);

  const validTypes = ["order", "rider", "payment", "promo", "wallet"];
  const typeFilter =
    query.type && query.type !== "all" && validTypes.includes(query.type)
      ? (query.type as any)
      : undefined;

  const where = {
    userId,
    ...(typeFilter ? { type: typeFilter } : {}),
  };

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasMore = notifications.length > take;
  const items = hasMore ? notifications.slice(0, take) : notifications;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { notifications: items, hasMore, nextCursor };
};

export const markVendorNotificationsRead = (userId: string) =>
  prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });

export const deleteVendorNotification = (userId: string, id: string) =>
  prisma.notification.deleteMany({ where: { id, userId } });

export const getVendorNotificationSettings = async (userId: string) => {
  let settings = await prisma.notificationSettings.findUnique({
    where: { userId },
  });
  if (!settings)
    settings = await prisma.notificationSettings.create({ data: { userId } });
  return settings;
};

export const updateVendorNotificationSettings = (
  userId: string,
  data: VendorNotificationSettingsPayload,
) =>
  prisma.notificationSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Private helper
// ─────────────────────────────────────────────────────────────────────────────

const _requireVendor = async (userId: string) => {
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
  if (!vendor) throw AppError.notFound("Vendor profile");
  return vendor;
};

export const getVendorBankAccountById = async (
  userId: string,
  bankId: string,
) => {
  const vendor = await _requireVendor(userId);
  const account = await prisma.vendorBankAccount.findFirst({
    where: { id: bankId, vendorId: vendor.id },
  });
  if (!account) throw AppError.notFound("Bank account");
  return { ...account, maskedNumber: maskAccountNumber(account.accountNumber) };
};

export const updateVendorBankAccount = async (
  userId: string,
  bankId: string,
  data: {
    bank?: string;
    name?: string;
    accountNumber?: string;
    bankCode?: string;
  },
): Promise<void> => {
  const vendor = await _requireVendor(userId);
  const account = await prisma.vendorBankAccount.findFirst({
    where: { id: bankId, vendorId: vendor.id },
  });
  if (!account) throw AppError.notFound("Bank account");
  await prisma.vendorBankAccount.update({ where: { id: bankId }, data });
};

export const getRiderLocationForOrder = async (
  userId: string,
  orderId: string,
) => {
  const vendor = await _requireVendor(userId);
  const order = await prisma.order.findFirst({
    where: { id: orderId, vendorId: vendor.id },
    include: {
      delivery: {
        include: {
          rider: { select: { currentLat: true, currentLng: true } },
        },
      },
    },
  });
  if (!order) throw AppError.notFound("Order");
  if (!order.delivery?.rider) return { lat: null, lng: null };
  return {
    lat: order.delivery.rider.currentLat,
    lng: order.delivery.rider.currentLng,
  };
};
