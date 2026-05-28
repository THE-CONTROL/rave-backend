// src/services/vendor.service.ts
import bcrypt from "bcryptjs";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { buildMeta, maskAccountNumber, parsePagination } from "../utils";
import { PaginationQuery } from "../types";
import { VendorNotificationSettingsPayload } from "../types/notifications";
import { cfg } from "./config.service";
import { format } from "date-fns"; //
import { th } from "date-fns/locale";

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

// src/services/vendor.service.ts

export const getVendorProfile = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      accountId: true, // e.g., NXV-8947
      fullName: true,
      email: true,
      phone: true,
      imageUrl: true,
      createdAt: true, // Used for "Member Since"
      vendorProfile: {
        select: {
          id: true,
          storeName: true,
          storeStatus: true,
          isOpen: true,
        },
      },
    },
  });

  if (!user) throw AppError.notFound("User");

  // Format date for UI
  const memberSince = new Date(user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return {
    ...user,
    memberSince,
  };
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

// src/services/vendor.service.ts

export const getDashboard = async (userId: string) => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { userId },
    include: {
      _count: {
        select: { menuItems: true, ordersReceived: true },
      },
    },
  });

  if (!vendor) throw AppError.notFound("Vendor profile");

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    todayOrders,
    todayRevenueAgg,
    preparing,
    ready,
    riderAssigned,
    ongoing,
    onboardingState,
  ] = await Promise.all([
    prisma.order.count({
      where: { vendorId: vendor.id, createdAt: { gte: startOfToday } },
    }),
    prisma.transaction.aggregate({
      where: {
        vendorId: vendor.id,
        type: "payment",
        status: "completed",
        createdAt: { gte: startOfToday },
      },
      _sum: { amount: true },
    }),
    prisma.order.count({ where: { vendorId: vendor.id, status: "preparing" } }),
    prisma.order.count({ where: { vendorId: vendor.id, status: "ready" } }),
    prisma.order.count({
      where: {
        vendorId: vendor.id,
        status: "accepted",
        delivery: { riderId: { not: "" } },
      },
    }),
    prisma.order.count({ where: { vendorId: vendor.id, status: "ongoing" } }),
    getVendorOnboardingState(userId),
  ]);

  return {
    isStoreOpen: vendor.isOpen,
    storeLogoUrl: vendor.logoUrl,
    storeName: vendor.storeName,
    storeStatus: vendor.storeStatus,
    onboarding: {
      complete: vendor.setupProgress === 5,
      setupProgress: vendor.setupProgress,
      resumeStep: onboardingState.resumeStep,
      stepsComplete: onboardingState.stepsComplete,
      steps: [
        {
          key: "basic",
          label: "Store Identity",
          completed: onboardingState.stepsComplete.step1Done,
        },
        {
          key: "branding",
          label: "Visuals",
          completed: onboardingState.stepsComplete.step2Done,
        },
        {
          key: "items",
          label: "Menu Items",
          completed: onboardingState.stepsComplete.step3Done,
        },
        {
          key: "bank",
          label: "Payout Info",
          completed: onboardingState.stepsComplete.step4Done,
        },
        {
          key: "review",
          label: "Store Review",
          completed: vendor.storeStatus !== "under_review",
        },
      ],
    },
    stats: {
      todayOrders,
      todayRevenue: todayRevenueAgg._sum.amount ?? 0,
      preparing,
      ready,
      riderAssigned,
      inTransit: ongoing,
      totalOrders: vendor._count.ordersReceived,
      totalItems: vendor._count.menuItems,
      totalRevenue: 0,
      completedOrders: 0,
      completionRate: 0,
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

  // if (vendor.storeStatus !== "open") {
  //   throw AppError.badRequest("Only activated stores can be opened.");
  // }
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

  // Use a transaction to ensure we don't lose data if something fails
  await prisma.$transaction([
    // 1. Delete ALL existing schedules for this vendor
    prisma.storeSchedule.deleteMany({
      where: { vendorId: vendor.id },
    }),

    // 2. Create the new set of schedules
    prisma.storeSchedule.createMany({
      data: schedules.map((s) => ({
        vendorId: vendor.id,
        day: s.day,
        openTime: s.openTime,
        closeTime: s.closeTime,
      })),
    }),
  ]);
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
      include: {
        categories: { include: { category: true } },
        images: true, // Ensure images are sent in the list view
        ingredients: true,
      },
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
        images: true, // Included images
        ingredients: true, // Included ingredients with new fields
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

export const createMenuItem = async (userId: string, data: any) => {
  const vendor = await _requireVendor(userId);
  const { categoryIds, ingredients, images, ...itemData } = data;

  return prisma.menuItem.create({
    data: {
      ...itemData,
      vendorId: vendor.id,
      // Create images using the {url, main} object structure
      images: {
        create: images.map((img: { url: string; main: boolean }) => ({
          url: img.url,
          isMain: img.main,
        })),
      },
      // Create ingredients with mealType and individual price
      ingredients: {
        create: ingredients.map((ing: any) => ({
          name: ing.name,
          portion: ing.portion,
          mealType: ing.mealType,
          isOptional: ing.isOptional,
          price: ing.price,
        })),
      },
      categories: {
        create: categoryIds.map((id: string) => ({ categoryId: id })),
      },
    },
    include: { images: true, ingredients: true, categories: true },
  });
};

export const updateMenuItem = async (
  userId: string,
  itemId: string,
  data: {
    name?: string;
    description?: string;
    price?: number;
    isActive?: boolean;
    isBestSeller?: boolean;
    isCustomizable?: boolean;
    categoryIds?: string[];
    images?: Array<{ url: string; main: boolean }>;
    ingredients?: Array<{
      name: string;
      portion: string;
      mealType: string;
      isOptional: boolean;
      price: number;
    }>;
  },
) => {
  const vendor = await _requireVendor(userId);
  const { categoryIds, ingredients, images, ...updateData } = data;

  const existing = await prisma.menuItem.findFirst({
    where: { id: itemId, vendorId: vendor.id },
  });

  if (!existing) throw AppError.notFound("Menu item not found or unauthorized");

  return prisma.menuItem.update({
    where: { id: itemId },
    data: {
      ...updateData,

      // 1. Sync Images: Clear and replace with updated object structure
      ...(images && {
        images: {
          deleteMany: {},
          create: images.map((img) => ({
            url: img.url,
            isMain: img.main,
          })),
        },
      }),

      // 2. Sync Ingredients: Updated with mealType and price
      ...(ingredients && {
        ingredients: {
          deleteMany: {},
          create: ingredients.map((ing) => ({
            name: ing.name,
            portion: ing.portion,
            mealType: ing.mealType,
            isOptional: ing.isOptional,
            price: ing.price,
          })),
        },
      }),

      // 3. Sync Categories
      ...(categoryIds && {
        categories: {
          deleteMany: {},
          create: categoryIds.map((categoryId) => ({
            categoryId,
          })),
        },
      }),
    },
    include: {
      images: true,
      ingredients: true,
      categories: {
        include: { category: true },
      },
    },
  });
};

export const deleteMenuItems = async (
  userId: string,
  ids: string[],
): Promise<void> => {
  const vendor = await _requireVendor(userId);
  // Cascade delete handles the ingredients and category joins automatically
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
      items: {
        include: { menuItem: { include: { ingredients: true } } },
      },
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
    items: order.items.map((item) => {
      const rawExtras = item.extras;
      const extrasIds: string[] = Array.isArray(rawExtras)
        ? (rawExtras as any[]).filter((x): x is string => typeof x === "string")
        : rawExtras !== null && typeof rawExtras === "object"
          ? Object.keys(rawExtras as Record<string, unknown>).filter(
              (k) => (rawExtras as Record<string, unknown>)[k] === true,
            )
          : [];

      const resolvedExtras = item.menuItem.ingredients
        .filter((ing) => extrasIds.includes(ing.id))
        .map((ing) => ({
          id: ing.id,
          name: ing.name,
          price: ing.price ?? 0,
        }));

      return {
        ...item,
        resolvedExtras,
        extrasTotal: resolvedExtras.reduce((sum, e) => sum + e.price, 0),
      };
    }),
    // Derived subtotal — the Order model stores no subtotal column, so we
    // back it out from the stored totals: total − fees + discount.
    subtotal:
      (order.totalAmount ?? 0) -
      (order.deliveryFee ?? 0) -
      (order.serviceFee ?? 0) -
      (order.vat ?? 0) +
      (order.discountAmount ?? 0),
    deliveryInstructions: order.deliveryInstructions,
    contactMethod: order.contactMethod ?? "in-app",
    deliveryLat: order.deliveryLat,
    deliveryLng: order.deliveryLng,
    vendorOtpVerified: order.delivery?.vendorOtpVerified ?? false,
    rider: rider
      ? {
          name: rider.user?.fullName ?? "",
          phone: rider.user?.phone ?? "",
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
      prisma.transaction.aggregate({
        where: { vendorId: vendor.id, type: "order" },
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

  const totalRevenue = totalTx?._sum?.amount ?? 0;
  const averageOrderValue = Math.round(totalTx?._avg?.amount ?? 0);

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
// Transactions
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorTransactions = async (
  userId: string,
  query: PaginationQuery & { type?: string },
) => {
  const vendor = await _requireVendor(userId);
  const { page, limit, skip } = parsePagination(query);

  // Only enum-valid types. "withdrawal"/"payout" don't exist on TransactionType,
  // so filtering by them previously returned an empty list silently.
  const validTypes = ["payment", "order", "refund"];
  const typeFilter =
    query.type &&
    query.type !== "all" &&
    validTypes.includes(query.type.toLowerCase())
      ? (query.type.toLowerCase() as any)
      : undefined;

  const where = {
    vendorId: vendor.id,
    ...(typeFilter ? { type: typeFilter } : {}),
  };

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  const formattedTransactions = transactions.map((tx: any) => {
    const isDebit = tx.type === "refund";
    const created = new Date(tx.createdAt);
    return {
      ...tx,
      // List card fields the shared component expects
      formattedAmount: `${isDebit ? "-" : "+"}₦${Math.abs(tx.amount).toLocaleString()}`,
      formattedDate: created.toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      }),
      formattedTime: created.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
      icon: isDebit ? "arrow-up" : "arrow-down",
      iconBg: isDebit ? "#FEF3F2" : "#ECFDF5",
    };
  });

  return {
    transactions: formattedTransactions,
    meta: buildMeta(total, page, limit),
  };
};

export const getVendorTransactionById = async (
  userId: string,
  txId: string,
) => {
  const vendor = await _requireVendor(userId);

  const tx = await prisma.transaction.findFirst({
    where: {
      id: txId,
      vendorId: vendor.id,
    },
    include: {
      order: {
        select: {
          id: true, // UUID — used for routing to order details
          orderId: true, // human-readable code (e.g. "cuid") — used for display
          createdAt: true,
          user: { select: { fullName: true } },
        },
      },
    },
  });

  if (!tx) throw AppError.notFound("Transaction record not found");

  const isRefund = tx.type === "refund";

  // Fee/net breakdown — only meaningful for earnings, not refunds.
  // amount is stored net (after the 10% platform fee), so gross = net / 0.9.
  const subtotal = tx.subtotal ?? tx.amount / 0.9;
  const fee = tx.fee ?? subtotal - tx.amount;

  // Prefer the snapshotted customerName; fall back to the live order's user.
  const customerName =
    tx.customerName ?? tx.order?.user?.fullName ?? "Customer";

  // Use the order's creation date for "Order Date" if available, else the tx date.
  const orderDate = tx.order?.createdAt ?? tx.createdAt;

  return {
    ...tx,
    isRefund,
    customerName,

    // Expose BOTH: routeOrderId (UUID) for navigation, displayOrderId (human) for UI.
    // `orderId` itself stays the UUID for backwards-compat with existing routing.
    orderId: tx.order?.id ?? tx.orderId,
    routeOrderId: tx.order?.id ?? tx.orderId,
    displayOrderId: tx.order?.orderId ?? tx.orderId,

    subtotal,
    fee,
    formattedDate: orderDate.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    }),
    formattedTime: orderDate.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
    creditDate: tx.updatedAt.toLocaleString("en-US"),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Onboarding — per-step save + resume
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorOnboardingState = async (userId: string) => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { userId },
    include: {
      user: true,
      bankAccounts: { where: { isPrimary: true }, take: 1 },
      schedules: true,
    },
  });

  if (!vendor) throw AppError.notFound("Vendor profile not found");

  const bank = vendor.bankAccounts[0];

  // 1. Store Information (Required: Store Name, Address, Bio/Description)
  const step1Done = !!(
    vendor.storeName &&
    vendor.address &&
    vendor.description
  );

  // 1. Store Location (Required: Location)
  const step1$5Done = !!(vendor.lat && vendor.lng);

  // 2. Branding & Availability (Required: Logo, Opening Time. Optional: Banner)
  const step2Done = !!(
    vendor.logoUrl &&
    vendor.schedules &&
    vendor.schedules.length > 0 // Opening time is required
  );

  // 3. Verification Documents (Required)
  const step3Done = !!(
    vendor.documentUrl &&
    vendor.documentType &&
    vendor.storeDoc &&
    vendor.storeDocType
  );

  // 4. Bank Details (Required)
  const step4Done = !!bank;

  // Determine where the user should resume
  let resumeStep = 1;
  if (!step1Done) resumeStep = 1;
  else if (!step1$5Done) resumeStep = 1.5;
  else if (!step2Done) resumeStep = 2;
  else if (!step3Done) resumeStep = 3;
  else if (!step4Done) resumeStep = 4;
  else resumeStep = 5;

  const doneCount = [step1Done, step2Done, step3Done, step4Done].filter(
    Boolean,
  ).length;

  return {
    resumeStep,
    setupProgress: Math.round((doneCount / 4) * 100),
    stepsComplete: { step1Done, step2Done, step3Done, step4Done },
    storeName: vendor.storeName,
    address: vendor.address || null,
    lat: vendor.lat || null,
    lng: vendor.lng || null,
    description: vendor.description,
    logoUrl: vendor.logoUrl,
    bannerUrl: vendor.bannerUrl, // Can be null, frontend should render plain green banner if missing
    documentType: (vendor as any).documentType,
    documentUrl: (vendor as any).documentUrl,
    storeDocType: (vendor as any).storeDocType,
    storeDoc: (vendor as any).storeDoc,
    schedules: vendor.schedules.map((s) => ({
      day: s.day,
      openTime: s.openTime,
      closeTime: s.closeTime,
    })),
    bank: bank
      ? {
          bank: bank.bankName,
          accountNumber: bank.accountNumber,
          name: bank.accountName,
          bankCode: bank.bankCode,
        }
      : null,
  };
};

export const saveVendorOnboardingStep = async (
  userId: string,
  step: number | string,
  data: any,
) => {
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
  if (!vendor) throw AppError.notFound("Vendor");

  if (step === 1 || step === 1.5) {
    const { storeName, address, description, lat, lng } = data;
    await prisma.vendorProfile.update({
      where: { id: vendor.id },
      data: { storeName, address, description, lat, lng },
    });

    if (address && lat && lng) {
      await prisma.vendorProfile.update({
        where: { userId },
        data: {
          address: address,
          lat: lat,
          lng: lng,
        },
      });
    }
  } else if (step === 2) {
    // Branding & Schedule
    const { logoUrl, bannerUrl, schedules } = data;

    await prisma.$transaction(async (tx) => {
      // 1. Update Profile Images
      // Safely update bannerUrl if provided; undefined won't overwrite existing
      await tx.vendorProfile.update({
        where: { id: vendor.id },
        data: {
          logoUrl,
          ...(bannerUrl !== undefined && { bannerUrl }),
        },
      });

      // 2. Update Schedules (Delete existing and recreate)
      if (schedules && Array.isArray(schedules)) {
        await tx.storeSchedule.deleteMany({
          where: { vendorId: vendor.id },
        });

        await tx.storeSchedule.createMany({
          data: schedules.map((s: any) => ({
            vendorId: vendor.id,
            day: s.day,
            openTime: s.openTime,
            closeTime: s.closeTime,
          })),
        });
      }
    });
  } else if (step === 3) {
    await prisma.vendorProfile.update({
      where: { id: vendor.id },
      data: {
        documentType: data.idType,
        documentUrl: data.docUrl,
        storeDocType: data.storeDocType,
        storeDoc: data.storeDoc,
      },
    });
  } else if (step === 4) {
    const { bank, name, accountNo, bankCode } = data;
    const requiredFields = [bank, name, accountNo, bankCode];
    const isValid = requiredFields.every(
      (field) => field && String(field).trim().length > 0,
    );
    if (isValid) {
      await prisma.bankAccount.upsert({
        where: {
          vendorId_accountNumber: {
            vendorId: vendor.id,
            accountNumber: accountNo,
          },
        },
        create: {
          vendorId: vendor.id,
          bankName: bank,
          accountName: name,
          accountNumber: accountNo,
          bankCode,
          isPrimary: true,
        },
        update: {
          bankName: bank,
          accountName: name,
          accountNumber: accountNo, // Fixed logic flaw here
          bankCode,
        },
      });
    }
  }

  return getVendorOnboardingState(userId);
};

export const submitVendorOnboarding = async (
  userId: string,
): Promise<{ success: boolean }> => {
  const state = await getVendorOnboardingState(userId);
  const { step1Done, step2Done, step3Done, step4Done } = state.stepsComplete;

  if (!step1Done || !step2Done || !step3Done || !step4Done)
    throw AppError.badRequest(
      "Please complete all required steps before submitting.",
    );

  // Make sure _requireVendor is imported/defined in your file scope
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
  const accounts = await prisma.bankAccount.findMany({
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
    bank: string; // Maps to bankName
    name: string; // Maps to accountName
    accountNumber: string;
    bankCode: string;
  },
): Promise<void> => {
  const vendor = await _requireVendor(userId);

  const count = await prisma.bankAccount.count({
    where: { vendorId: vendor.id },
  });

  await prisma.bankAccount.create({
    data: {
      vendorId: vendor.id,
      isPrimary: count === 0,
      bankName: data.bank, // Corrected field name
      accountName: data.name, // Corrected field name
      accountNumber: data.accountNumber,
      bankCode: data.bankCode,
    },
  });
};

export const setVendorPrimaryBank = async (
  userId: string,
  bankId: string,
): Promise<void> => {
  const vendor = await _requireVendor(userId);
  await prisma.$transaction([
    prisma.bankAccount.updateMany({
      where: { vendorId: vendor.id },
      data: { isPrimary: false },
    }),
    prisma.bankAccount.update({
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
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankId, vendorId: vendor.id },
  });
  if (!account) throw AppError.notFound("Bank account");
  await prisma.bankAccount.delete({ where: { id: bankId } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Promotions
// ─────────────────────────────────────────────────────────────────────────────

export const getPromotions = async (
  userId: string,
  query: PaginationQuery & { status?: string } = {},
) => {
  const vendor = await _requireVendor(userId);
  const { page, limit, skip } = parsePagination(query);
  const now = new Date();

  const where = {
    vendorId: vendor.id,
    ...(query.status === "active"
      ? { isActive: true, endDate: { gte: now } }
      : {}),
    ...(query.status === "expired"
      ? { OR: [{ isActive: false }, { endDate: { lt: now } }] }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.promotion.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.promotion.count({ where }),
  ]);

  return {
    data,
    meta: buildMeta(total, page, limit),
  };
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
    // New fields
    appliesTo: "all" | "specific";
    productIds?: string[];
  },
) => {
  const vendor = await _requireVendor(userId);

  return prisma.promotion.create({
    data: {
      ...data,
      vendorId: vendor.id,
      // If appliesTo is 'all', we ensure productIds is an empty array
      productIds: data.appliesTo === "all" ? [] : data.productIds || [],
    },
  });
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
    // New fields for editing
    appliesTo: "all" | "specific";
    productIds: string[];
  }>,
) => {
  const vendor = await _requireVendor(userId);

  const existing = await prisma.promotion.findFirst({
    where: { id: promoId, vendorId: vendor.id },
  });

  if (!existing) throw AppError.notFound("Promotion");

  // Logic to handle product scope switching
  const updatedData = { ...data };
  if (data.appliesTo === "all") {
    updatedData.productIds = [];
  }

  return prisma.promotion.update({
    where: { id: promoId },
    data: updatedData,
  });
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

export const getVendorReferralStats = async (
  userId: string,
  query: PaginationQuery = {},
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });

  if (!user) throw AppError.notFound("User");

  const { page, limit, skip } = parsePagination(query);

  const [referrals, totalReferrals, earned] = await Promise.all([
    prisma.referral.findMany({
      where: { referrerId: userId },
      include: {
        referee: {
          select: {
            fullName: true,
            imageUrl: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.referral.count({ where: { referrerId: userId } }),
    prisma.transaction.aggregate({
      where: {
        userId,
        type: "referral",
        status: "completed",
      },
      _sum: { amount: true },
    }),
  ]);

  return {
    referralCode: user.referralCode,
    totalReferrals,
    amountEarned: earned._sum?.amount ?? 0,
    // Map the data to match the VendorReferralStats interface exactly
    recentReferrals: referrals.map((ref) => ({
      id: ref.id,
      status: ref.status, // Ensure your DB uses 'PENDING' | 'COMPLETED'
      createdAt: format(new Date(ref.createdAt), "dd MMM yyyy"), // e.g., "12 Jun 2025"
      referee: {
        fullName: ref.referee.fullName,
        imageUrl: ref.referee.imageUrl,
      },
    })),
    meta: buildMeta(totalReferrals, page, limit),
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

export const _requireVendor = async (userId: string) => {
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
  if (!vendor) throw AppError.notFound("Vendor profile");
  return vendor;
};

export const getVendorBankAccountById = async (
  userId: string,
  bankId: string,
) => {
  const vendor = await _requireVendor(userId);
  const account = await prisma.bankAccount.findFirst({
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
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankId, vendorId: vendor.id },
  });
  if (!account) throw AppError.notFound("Bank account");
  await prisma.bankAccount.update({ where: { id: bankId }, data });
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
