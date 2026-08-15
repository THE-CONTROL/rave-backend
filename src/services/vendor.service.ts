// src/services/vendor.service.ts
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { encryptSearchable, decrypt } from "../utils/crypto";
import {
  buildMeta,
  maskAccountNumber,
  parsePagination,
  pickReviewTags,
  relativeTimeAgo,
  resolveDateRange,
  resolveSort,
} from "../utils";
import { computeMetricValue } from "./badgeEvaluation.service";
import { PaginationQuery } from "../types";
import { VendorNotificationSettingsPayload } from "../types/notifications";
import { format } from "date-fns"; //
import * as notif from "../events/notification.events";
import { cfg } from "./config.service";
import { ps } from "./payment.service";
import * as refundProcessing from "./shared/refundProcessing.service";

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

  // A stolen refresh token shouldn't survive a legitimate password change.
  await prisma.refreshToken.deleteMany({ where: { userId } });
};

export const deleteVendorAccount = async (userId: string): Promise<void> => {
  await prisma.user.update({
    where: { id: userId },
    data: {
      isActive: false,
      email: `deleted_vendor_${userId}@rave.com`,
      // Mirrors the user-account soft-delete: free the unique phone column
      // for reuse instead of locking it out forever.
      phone: `deleted_vendor_${userId}`,
    },
  });

  // Deactivating the account should kill any existing session immediately,
  // not just block future logins.
  await prisma.refreshToken.deleteMany({ where: { userId } });
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
        // Vendor earnings are recorded as type "order" (the customer's order
        // payment). type "payment" is the RIDER payout — summing that here is
        // why today's revenue read wrong/zero. Match the analytics page, which
        // also sums type "order".
        type: "order",
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
        // A Delivery row only exists once a rider has accepted, so "rider
        // assigned" = the order has a delivery. (riderId on Delivery is a
        // required column, so the old `not: ""` / `not: null` guards were both
        // wrong — checking the relation's existence is the correct test.)
        delivery: { isNot: null },
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
    storeStatusReason: vendor.storeStatusReason,
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
    // Preview/mystore read `reviewNumber`; stored field is `totalReviews`.
    // Alias it so "% positive" / order-accuracy compute instead of NaN → 0%.
    reviewNumber: vendor.totalReviews,
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
    latitude?: number;
    longitude?: number;
  },
) => {
  const vendor = await _requireVendor(userId);

  // The frontend sends `latitude`/`longitude`, but the VendorProfile columns
  // are `lat`/`lng`. Pull the coordinates out and map them to the real column
  // names; spreading them straight into Prisma would either error on unknown
  // fields or (as before) be a no-op. Only include a coordinate when it was
  // actually provided so partial updates (e.g. just the store name) don't
  // clobber existing values with undefined.
  const { latitude, longitude, ...rest } = data;

  return prisma.vendorProfile.update({
    where: { id: vendor.id },
    data: {
      ...rest,
      ...(latitude !== undefined ? { lat: latitude } : {}),
      ...(longitude !== undefined ? { lng: longitude } : {}),
    },
  });
};

export const toggleStoreOpen = async (
  userId: string,
): Promise<{ isOpen: boolean }> => {
  const vendor = await _requireVendor(userId);
  const nextIsOpen = !vendor.isOpen;

  // Only block turning the store ON while it isn't activated — always allow
  // turning it OFF, even for a store that was since paused/denied, so a
  // vendor can never get stuck unable to close.
  if (nextIsOpen && vendor.storeStatus !== "open") {
    throw AppError.badRequest("Only activated stores can be opened.");
  }

  const updated = await prisma.vendorProfile.update({
    where: { id: vendor.id },
    data: { isOpen: nextIsOpen },
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
        optionGroups: {
          include: {
            options: {
              include: { sizes: { orderBy: { sortOrder: "asc" } } },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    }),
    prisma.review.findMany({
      where: {
        OR: [
          { menuItemIds: { has: itemId } },
          { order: { items: { some: { menuItemId: itemId } } } },
        ],
      },
      include: { user: { select: { fullName: true, imageUrl: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  if (!item) throw AppError.notFound("Menu item");

  // Shape reviews for the menu-item detail screen: expose a single `rating`
  // (the food score, since this is a per-item view) plus the food-relevant
  // photos and tags, with their role prefixes stripped.
  const shapedReviews = reviews.map((r) => ({
    id: r.id,
    user: r.user,
    customerName: r.user.fullName,
    customerImage: r.user.imageUrl,
    rating: r.foodRating,
    comment: r.comment ?? "",
    tags: pickReviewTags(r.tags, "food"),
    proofUrls: pickReviewTags(r.proofUrls, "food"),
    date: r.createdAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));

  return { ...item, reviews: shapedReviews };
};

export const createMenuItem = async (userId: string, data: any) => {
  const vendor = await _requireVendor(userId);
  const { categoryIds, ingredients, images, optionGroupIds, ...itemData } =
    data;

  // Only attach option groups that actually belong to this vendor, so a
  // crafted request can't bolt another vendor's group onto this item.
  const ownedGroupIds = Array.isArray(optionGroupIds)
    ? await _filterOwnedOptionGroupIds(vendor.id, optionGroupIds)
    : [];

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
      // Attach reusable option groups (validated to belong to this vendor).
      ...(ownedGroupIds.length > 0
        ? { optionGroups: { connect: ownedGroupIds.map((id) => ({ id })) } }
        : {}),
    },
    include: {
      images: true,
      ingredients: true,
      categories: true,
      optionGroups: true,
    },
  });
};

/** Returns the subset of the given option-group ids owned by this vendor. */
const _filterOwnedOptionGroupIds = async (
  vendorId: string,
  ids: string[],
): Promise<string[]> => {
  if (ids.length === 0) return [];
  const owned = await prisma.optionGroup.findMany({
    where: { vendorId, id: { in: ids } },
    select: { id: true },
  });
  return owned.map((g) => g.id);
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
    optionGroupIds?: string[];
  },
) => {
  const vendor = await _requireVendor(userId);
  const { categoryIds, ingredients, images, optionGroupIds, ...updateData } =
    data;

  const existing = await prisma.menuItem.findFirst({
    where: { id: itemId, vendorId: vendor.id },
  });

  if (!existing) throw AppError.notFound("Menu item not found or unauthorized");

  // Resolve the vendor-owned subset up front so the update payload stays a
  // plain object (no inline await).
  const ownedGroupIds = optionGroupIds
    ? await _filterOwnedOptionGroupIds(vendor.id, optionGroupIds)
    : undefined;

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

      // 4. Sync attached option groups — `set` replaces the whole attachment
      //    list, so deselecting a group in the editor detaches it. Only
      //    vendor-owned groups are honoured.
      ...(ownedGroupIds && {
        optionGroups: {
          set: ownedGroupIds.map((id) => ({ id })),
        },
      }),
    },
    include: {
      images: true,
      ingredients: true,
      categories: {
        include: { category: true },
      },
      optionGroups: true,
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
  query: PaginationQuery & { status?: string; search?: string },
) => {
  const vendor = await _requireVendor(userId);
  const { page, limit, skip } = parsePagination(query);

  const ALL_STATUSES = [
    "new",
    "accepted",
    "preparing",
    "ready",
    "ongoing",
    "completed",
    "cancelled",
  ] as const;

  const statusMap: Record<string, readonly string[]> = {
    all: ALL_STATUSES,
    active: ["new", "accepted", "preparing", "ready", "ongoing"],
    completed: ["completed"],
    cancelled: ["cancelled"],
  };

  // The tab defines the allowed status group. An optional precise `status`
  // (the sub-status pills on the "active" tab) narrows within that group —
  // and crucially is applied server-side so it paginates correctly. Applying
  // it client-side (the old behaviour) broke infinite scroll: a sub-status
  // whose orders lived on later pages could never load, because onEndReached
  // fired on the filtered (often empty) list.
  const tabStatuses = statusMap[tab] ?? statusMap.active;

  const status =
    query.status && query.status !== "all"
      ? // Only honour a precise status if it belongs to this tab's group,
        // otherwise ignore it (prevents e.g. ?status=completed on the active tab).
        tabStatuses.includes(query.status)
        ? [query.status]
        : tabStatuses
      : tabStatuses;

  const search = query.search?.trim();

  const where = {
    vendorId: vendor.id,
    status: { in: status as (typeof ALL_STATUSES)[number][] },
    // Server-side search across the human order id and the customer name, so
    // search spans the entire result set, not just the pages already loaded.
    ...(search
      ? {
          OR: [
            { orderId: { contains: search, mode: "insensitive" as const } },
            {
              user: {
                fullName: { contains: search, mode: "insensitive" as const },
              },
            },
          ],
        }
      : {}),
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
        include: {
          menuItem: {
            include: {
              ingredients: true,
              optionGroups: {
                include: { options: { include: { sizes: true } } },
              },
            },
          },
        },
      },
      user: { select: { fullName: true, phone: true, imageUrl: true } },
      delivery: {
        include: {
          rider: {
            select: {
              currentLat: true,
              currentLng: true,
              averageRating: true,
              totalReviews: true,
              user: { select: { fullName: true, phone: true, imageUrl: true } },
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

      // Surface the customer's chosen option-group sizes (e.g. "Large",
      // add-ons) so the vendor sees exactly what to prepare.
      for (const group of item.menuItem.optionGroups ?? []) {
        for (const opt of group.options ?? []) {
          for (const size of opt.sizes ?? []) {
            if (extrasIds.includes(size.id)) {
              resolvedExtras.push({
                id: size.id,
                name: `${opt.name} · ${size.name}`,
                price: size.extraPrice ?? 0,
              });
            }
          }
        }
      }

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
          image: rider.user?.imageUrl ?? null,
          lat: rider.currentLat,
          lng: rider.currentLng,
          rating: rider.averageRating ?? 0,
          reviewCount: rider.totalReviews ?? 0,
        }
      : null,
    // The tracking screen reads order.restaurant.{name,image,lat,lng}. This
    // block was missing entirely, so those were all undefined → the map pinned
    // the store at (0,0) with no name/image. Build it from the vendor's own
    // profile (already loaded by _requireVendor), matching the user-side shape.
    restaurant: {
      name: vendor.storeName,
      image: vendor.logoUrl ?? null,
      address: vendor.address ?? null,
      lat: vendor.lat ?? null,
      lng: vendor.lng ?? null,
    },
    // Confirmation media for the vendor's order details screen: the packing
    // video the vendor recorded, and the rider's pickup/delivery proof photos.
    confirmationMedia: {
      packingVideoUrl: order.packingVideoUrl ?? null,
      pickupProofUrl: order.delivery?.pickupProofUrl ?? null,
      deliveryProofUrl: order.delivery?.deliveryProofUrl ?? null,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

export const getAnalytics = async (
  userId: string,
  opts?: { filter?: string; startDate?: string; endDate?: string },
) => {
  const vendor = await _requireVendor(userId);

  // ── Resolve the requested window ───────────────────────────────────────────
  // A custom range (startDate/endDate from the calendar) always wins. The end
  // is pushed to the end of its day so a single-day pick (16th → 16th) or an
  // inclusive range (16th → 20th) actually covers those whole days instead of
  // stopping at 00:00. Named filters (Today / This Week / …) are resolved when
  // no custom range is supplied.
  const now = new Date();
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };

  let from: Date | undefined;
  let to: Date | undefined;

  if (opts?.startDate) {
    from = startOfDay(new Date(opts.startDate));
    // Single-day pick → endDate may be missing; fall back to the start's day.
    to = endOfDay(new Date(opts.endDate ?? opts.startDate));
  } else {
    switch ((opts?.filter ?? "Today").toLowerCase()) {
      case "today":
        from = startOfDay(now);
        break;
      case "this week":
        from = startOfDay(new Date(now.getTime() - 6 * 86_400_000));
        break;
      case "this month":
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "this year":
        from = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        from = undefined; // all-time
    }
    to = now;
  }

  const rangeFilter = (gte?: Date, lte?: Date) =>
    gte || lte
      ? { createdAt: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } }
      : {};

  const createdAtFilter = rangeFilter(from, to);

  // ── Previous window of equal length (for growth %) ─────────────────────────
  let prevFilter: Record<string, unknown> = {};
  if (from && to) {
    const span = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - span);
    prevFilter = rangeFilter(prevFrom, prevTo);
  }

  const IN_PROGRESS = ["accepted", "preparing", "ready", "ongoing"] as const;
  const [
    totalTx,
    totalOrders,
    completedOrders,
    cancelledOrders,
    declinedOrders,
    pendingAgg,
    prevTx,
    prevOrders,
  ] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        vendorId: vendor.id,
        type: "order",
        status: "completed",
        ...createdAtFilter,
      },
      _sum: { amount: true },
      _avg: { amount: true },
    }),
    prisma.order.count({ where: { vendorId: vendor.id, ...createdAtFilter } }),
    prisma.order.count({
      where: { vendorId: vendor.id, status: "completed", ...createdAtFilter },
    }),
    // Customer-cancelled orders only (the vendor's declines live in the next
    // count so the two cards don't double-count the same order).
    prisma.order.count({
      where: {
        vendorId: vendor.id,
        status: "cancelled",
        NOT: { cancelledBy: "store" },
        ...createdAtFilter,
      },
    }),
    // Vendor-declined orders.
    prisma.order.count({
      where: {
        vendorId: vendor.id,
        status: "cancelled",
        cancelledBy: "store",
        ...createdAtFilter,
      },
    }),
    // Pending earnings = value of orders currently in progress (accepted →
    // ongoing) that haven't settled yet.
    prisma.order.aggregate({
      where: {
        vendorId: vendor.id,
        status: { in: IN_PROGRESS as any },
        ...createdAtFilter,
      },
      _sum: { totalAmount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        vendorId: vendor.id,
        type: "order",
        status: "completed",
        ...prevFilter,
      },
      _sum: { amount: true },
    }),
    prisma.order.count({ where: { vendorId: vendor.id, ...prevFilter } }),
  ]);

  const totalRevenue = totalTx?._sum?.amount ?? 0;
  const averageOrderValue = Math.round(totalTx?._avg?.amount ?? 0);
  const pendingEarnings = pendingAgg?._sum?.totalAmount ?? 0;

  const pct = (curr: number, prev: number) =>
    prev > 0 ? Math.round(((curr - prev) / prev) * 100) : curr > 0 ? 100 : 0;

  return {
    totalRevenue,
    revenueGrowth: pct(totalRevenue, prevTx?._sum?.amount ?? 0),
    pendingEarnings,
    averageOrderValue,
    totalOrders,
    ordersGrowth: pct(totalOrders, prevOrders),
    completedOrders,
    completionRate:
      totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0,
    cancelledOrders,
    cancellationRate:
      totalOrders > 0 ? Math.round((cancelledOrders / totalOrders) * 100) : 0,
    declinedOrders,
    declinedRate:
      totalOrders > 0 ? Math.round((declinedOrders / totalOrders) * 100) : 0,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Transactions
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorTransactions = async (
  userId: string,
  query: PaginationQuery & { type?: string; range?: string; sort?: string },
) => {
  const vendor = await _requireVendor(userId);
  const { page, limit, skip } = parsePagination(query);

  // Types actually written against a vendorId: "order" (the customer's
  // payment = the vendor's earning), "refund", and "payment" (a vendor
  // payout/withdrawal — see withdrawVendorFunds, which mirrors the rider
  // payout convention of using type "payment" for a real bank payout row).
  const validTypes = ["order", "refund", "payment"];

  const typeFilter =
    query.type &&
    query.type !== "all" &&
    validTypes.includes(query.type.toLowerCase())
      ? (query.type.toLowerCase() as any)
      : undefined;

  // ── Hide pending transactions that have been superseded by a completed
  // FIN_ counterpart. When a Paystack payment confirms, a fresh transaction
  // with reference FIN_<original> is written alongside the still-pending
  // original. Without this filter, the vendor sees both in their history.
  // ─────────────────────────────────────────────────────────────────────────
  const shadowedRefs = await prisma.transaction
    .findMany({
      where: {
        vendorId: vendor.id,
        status: "completed",
        reference: { startsWith: "FIN_" },
      },
      select: { reference: true },
    })
    .then((rows) =>
      rows
        .map((r) => r.reference?.replace(/^FIN_/, ""))
        .filter((r): r is string => !!r),
    );

  const where = {
    vendorId: vendor.id,
    ...(typeFilter ? { type: typeFilter } : {}),
    ...resolveDateRange(query.range),
    ...(shadowedRefs.length > 0
      ? {
          NOT: [
            {
              status: "initiated" as const,
              reference: { in: shadowedRefs },
            },
          ],
        }
      : {}),
  };

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: resolveSort(query.sort) },
      skip,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  const formattedTransactions = transactions.map((tx: any) => ({
    ...tx,
    formattedAmount: `₦${tx.amount.toLocaleString()}`,
    formattedDate: tx.createdAt.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    }),
    formattedTime: tx.createdAt.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
    iconBg:
      tx.type === "payment" || tx.type === "order" ? "#FEF3F2" : "#ECFDF5",
  }));

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
  //
  // Since payment.service.ts's initializeCheckout now stores the real
  // subtotal/fee at transaction-creation time (computed from the vendor's
  // actual item subtotal × cfg.fees.vendorCommission()), tx.subtotal/tx.fee
  // are populated for every NEW order transaction and this fallback is
  // unreachable for them.
  //
  // LEGACY FALLBACK ONLY: transactions created before that fix never had
  // subtotal/fee written, so tx.subtotal/tx.fee are null on those old rows.
  // For those (and only those) we reconstruct an approximate breakdown by
  // assuming the old (incorrect) convention that `amount` was net-of-10%-fee,
  // i.e. gross = net / 0.9. This is a best-effort display for historical data
  // and intentionally left in place — do not remove until old rows have been
  // migrated/backfilled.
  const subtotal = tx.subtotal ?? tx.amount / 0.9;
  const fee = tx.fee ?? subtotal - tx.amount;
  // Effective commission rate for THIS transaction (works for both new rows,
  // where it reflects the real configured rate, and legacy rows, where the
  // fallback above always yields ~10%) — lets the UI show the true rate
  // instead of a hardcoded "10%" label.
  const feeRate = subtotal > 0 ? fee / subtotal : 0;

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
    feeRate,
    // The vendor's real take-home for this order — subtotal minus the
    // platform commission. NOT tx.amount, which is the customer's full
    // checkout total (delivery fee + VAT + service fee included) and was
    // never the vendor's money.
    netEarnings: subtotal - fee,
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
          // Masked — never send the decrypted account number back to a
          // client. The onboarding resume screen only needs to show that a
          // bank is on file, not the full number.
          accountNumber: maskAccountNumber(decrypt(bank.accountNumber)),
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
      // Deterministic encryption (encryptSearchable) — same plaintext always
      // maps to the same ciphertext, so this compound-unique lookup and the
      // @@unique([vendorId, accountNumber]) DB constraint keep working
      // exactly as before, without a schema change or a second lookup column.
      const encryptedAccountNo = encryptSearchable(accountNo);
      await prisma.bankAccount.upsert({
        where: {
          vendorId_accountNumber: {
            vendorId: vendor.id,
            accountNumber: encryptedAccountNo,
          },
        },
        create: {
          vendorId: vendor.id,
          bankName: bank,
          accountName: name,
          accountNumber: encryptedAccountNo,
          bankCode,
          isPrimary: true,
        },
        update: {
          bankName: bank,
          accountName: name,
          accountNumber: encryptedAccountNo, // Fixed logic flaw here
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

  // Submitting setup — whether for the first time or as a resubmission after
  // already being approved/denied/suspended — always sends the store back
  // into the admin review queue. A vendor that edited their name/address/
  // logo/documents and re-submitted shouldn't stay silently `open` (or stuck
  // `denied`) with unreviewed changes; `under_review` is a no-op if this is
  // the first-ever submission, since that's already the default status.
  await prisma.vendorProfile.update({
    where: { id: vendor.id },
    data: {
      setupProgress: 100,
      storeStatus: "under_review",
      storeStatusReason: null,
      isOpen: false,
    } as any,
  });

  await notif.notifyAdminsVendorSubmittedOnboarding(vendor.storeName);

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
  // Never send the decrypted account number to a client — only the masked
  // form. `accountNumber` on the returned object is intentionally overwritten
  // with the same masked value (rather than the raw ciphertext) so a caller
  // spreading this response can't accidentally leak the encrypted payload.
  return accounts.map((a) => {
    const masked = maskAccountNumber(decrypt(a.accountNumber));
    return { ...a, accountNumber: masked, maskedNumber: masked };
  });
};

const MAX_BANK_ACCOUNTS_PER_ROLE = 3;

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

  if (count >= MAX_BANK_ACCOUNTS_PER_ROLE) {
    throw AppError.badRequest(
      `You can only save up to ${MAX_BANK_ACCOUNTS_PER_ROLE} bank accounts.`,
    );
  }

  // Deterministic encryption (encryptSearchable) so this equality lookup and
  // the @@unique([vendorId, accountNumber]) constraint keep working exactly
  // as before encryption was introduced.
  const encryptedAccountNo = encryptSearchable(data.accountNumber);

  const duplicate = await prisma.bankAccount.findFirst({
    where: {
      vendorId: vendor.id,
      accountNumber: encryptedAccountNo,
      bankCode: data.bankCode,
    },
  });
  if (duplicate) {
    throw AppError.badRequest("This bank account is already saved.");
  }

  await prisma.bankAccount.create({
    data: {
      vendorId: vendor.id,
      isPrimary: count === 0,
      bankName: data.bank, // Corrected field name
      accountName: data.name, // Corrected field name
      accountNumber: encryptedAccountNo,
      bankCode: data.bankCode,
    },
  });
};

export const setVendorPrimaryBank = async (
  userId: string,
  bankId: string,
): Promise<void> => {
  const vendor = await _requireVendor(userId);
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankId, vendorId: vendor.id },
  });
  if (!account) throw AppError.notFound("Bank account");

  await prisma.$transaction([
    prisma.bankAccount.updateMany({
      where: { vendorId: vendor.id },
      data: { isPrimary: false },
    }),
    // Scoped to vendorId as well — not just id — so a crafted bankId
    // belonging to another vendor can never be flipped to primary here.
    prisma.bankAccount.update({
      where: { id: bankId, vendorId: vendor.id },
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
    maxUses?: number;
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

  // Defense-in-depth: re-validate end-after-start using the *effective*
  // dates (new value if provided, otherwise whatever is already stored),
  // so a partial update that only touches one of the two dates can never
  // leave the promotion with an end date at or before its start date.
  const effectiveStart = new Date(updatedData.startDate ?? existing.startDate);
  const effectiveEnd = new Date(updatedData.endDate ?? existing.endDate);
  if (effectiveEnd <= effectiveStart) {
    throw AppError.badRequest("End date must be after start date");
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

  // averageRating/totalReviews are already maintained as cached aggregates on
  // VendorProfile (see user.service.ts#submitReview, which recomputes them
  // with this exact (restaurantRating + foodRating) / 2 formula on every new
  // review) — the same pattern catalog.service.ts reads from directly. No
  // need to load every review row just to recompute numbers that are already
  // sitting on the vendor's own profile.
  if (vendor.totalReviews === 0) {
    return { averageRating: 0, totalReviews: 0, distribution: {} };
  }

  // Only the star-count distribution actually requires per-review data (it
  // isn't cached anywhere) — computed as a GROUP BY in the database instead
  // of pulling every review row into app memory just to bucket it here.
  // riderRating intentionally excluded from the bucketed score — that's the
  // rider's stat, not the vendor's. See submitReview for the matching formula.
  const buckets = await prisma.$queryRaw<Array<{ bucket: number; count: bigint }>>`
    SELECT ROUND(("restaurantRating" + "foodRating") / 2.0)::int AS bucket, count(*) AS count
    FROM "reviews"
    WHERE "vendorId" = ${vendor.id}
    GROUP BY bucket
  `;

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const b of buckets) {
    distribution[b.bucket] = Number(b.count);
  }

  return {
    averageRating: vendor.averageRating,
    totalReviews: vendor.totalReviews,
    distribution,
  };
};

export const getVendorReviews = async (
  userId: string,
  query: PaginationQuery & {
    rating?: string;
    hasComment?: string;
    sort?: string;
  },
) => {
  const vendor = await _requireVendor(userId);
  const { page, limit, skip } = parsePagination(query);

  // Star filter (exact match, 1–5) and sort, applied server-side so they
  // page correctly — mirrors getRiderReviews.
  const ratingNum = query.rating ? Number(query.rating) : undefined;
  const ratingFilter =
    ratingNum && ratingNum >= 1 && ratingNum <= 5
      ? { restaurantRating: ratingNum }
      : {};

  const where = {
    vendorId: vendor.id,
    ...ratingFilter,
    ...(query.hasComment === "true" ? { comment: { not: null } } : {}),
  };

  const orderBy =
    query.sort === "oldest"
      ? { createdAt: "asc" as const }
      : query.sort === "highest"
        ? { restaurantRating: "desc" as const }
        : query.sort === "lowest"
          ? { restaurantRating: "asc" as const }
          : { createdAt: "desc" as const };

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where,
      include: {
        user: { select: { fullName: true, imageUrl: true } },
        order: {
          select: {
            createdAt: true,
            items: { select: { name: true }, take: 1 },
          },
        },
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.review.count({ where }),
  ]);

  const shaped = reviews.map((r) => ({
    ...r,
    tags: pickReviewTags(r.tags, "vendor", "food"),
    proofUrls: pickReviewTags(r.proofUrls, "vendor", "food"),
  }));

  return { reviews: shaped, meta: buildMeta(total, page, limit) };
};

// ─────────────────────────────────────────────────────────────────────────────
// Badges
// ─────────────────────────────────────────────────────────────────────────────

// Simple XP-threshold rank ladder, lowest to highest. A vendor's rank is the
// highest entry whose `minXp` their total unlocked-badge XP meets or exceeds.
const BADGE_RANKS = [
  { name: "Newcomer", minXp: 0 },
  { name: "Rising Star", minXp: 300 },
  { name: "Pro", minXp: 700 },
  { name: "Elite", minXp: 1500 },
] as const;

export const getBadgeStats = async (userId: string) => {
  const vendor = await _requireVendor(userId);
  const [unlockedBadges, inProgress] = await Promise.all([
    prisma.vendorBadge.findMany({
      where: { vendorId: vendor.id, state: "unlocked" },
      include: { badge: { select: { xpReward: true } } },
    }),
    prisma.vendorBadge.count({
      where: { vendorId: vendor.id, state: "in_progress" },
    }),
  ]);

  const badgesUnlocked = unlockedBadges.length;
  const xp = unlockedBadges.reduce(
    (sum, vb) => sum + (vb.badge?.xpReward ?? 0),
    0,
  );

  // Highest rank whose threshold has been met.
  const rankIndex = BADGE_RANKS.reduce(
    (acc, tier, i) => (xp >= tier.minXp ? i : acc),
    0,
  );
  const rank = BADGE_RANKS[rankIndex].name;
  // Floor XP of the current bracket — lets the client compute progress
  // *within* the current rank's range rather than from zero.
  const rankMinXp = BADGE_RANKS[rankIndex].minXp;
  const nextTier = BADGE_RANKS[rankIndex + 1] ?? null;
  const nextRank = nextTier
    ? { name: nextTier.name, xpNeeded: nextTier.minXp }
    : null;

  return { badgesUnlocked, inProgress, xp, rank, rankMinXp, nextRank };
};

export const getBadges = async (userId: string) => {
  const vendor = await _requireVendor(userId);
  return prisma.vendorBadge.findMany({
    where: { vendorId: vendor.id },
    include: { badge: { include: { requirements: true } } },
    orderBy: { createdAt: "desc" },
  });
};

// Shapes the raw VendorBadge row into the `BadgeDetail` the mobile detail
// screen actually reads (about/progressPercent/requirements[].completed/
// reward.perks/earnedAgo) — VendorBadge.current is only a single "furthest
// behind" progress number shared across all requirements, so per-requirement
// current/completed values are computed live here instead.
export const getBadgeById = async (userId: string, badgeId: string) => {
  const vendor = await _requireVendor(userId);
  const vb = await prisma.vendorBadge.findFirst({
    where: { vendorId: vendor.id, badgeId },
    include: { badge: { include: { requirements: true } } },
  });
  if (!vb) throw AppError.notFound("Badge");

  const requirements = await Promise.all(
    vb.badge.requirements.map(async (req) => {
      const current = await computeMetricValue(vendor.id, req.metric);
      return {
        id: req.id,
        label: req.label,
        total: req.total,
        current,
        completed: req.total != null ? current >= req.total : false,
      };
    }),
  );

  const progressPercent =
    vb.state === "unlocked"
      ? 100
      : requirements.length === 0
        ? 0
        : Math.round(
            Math.min(
              100,
              Math.min(
                ...requirements.map((r) => (r.total ? (r.current / r.total) * 100 : 100)),
              ),
            ),
          );

  return {
    id: vb.id,
    name: vb.badge.name,
    icon: vb.badge.icon,
    state: vb.state,
    about: vb.badge.description ?? "",
    progressPercent,
    earnedAgo: vb.earnedAt ? relativeTimeAgo(vb.earnedAt) : undefined,
    requirements,
    reward: { xp: vb.badge.xpReward, perks: vb.badge.perks },
  };
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

export const getUnreadNotificationCount = async (
  userId: string,
): Promise<{ count: number }> => {
  const count = await prisma.notification.count({
    where: { userId, isRead: false },
  });
  return { count };
};

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
  const masked = maskAccountNumber(decrypt(account.accountNumber));
  return { ...account, accountNumber: masked, maskedNumber: masked };
};

export const updateVendorBankAccount = async (
  userId: string,
  bankId: string,
  data: {
    bankName?: string;
    accountName?: string;
    accountNumber?: string;
    bankCode?: string;
  },
): Promise<void> => {
  const vendor = await _requireVendor(userId);
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankId, vendorId: vendor.id },
  });
  if (!account) throw AppError.notFound("Bank account");
  // Unlike saveVendorBankAccount's create path (which still receives the
  // legacy bank/name aliases from the "add account" form and remaps them),
  // the edit screen already sends the real bankName/accountName Prisma
  // column names directly — see vendorUpdateBankSchema — so this can pass
  // the fields straight through instead of forwarding {bank, name} into a
  // Prisma model that has no such columns (which is what crashed before).
  await prisma.bankAccount.update({
    where: { id: bankId, vendorId: vendor.id },
    data: {
      ...data,
      // Deterministic encryption (encryptSearchable) — see saveVendorBankAccount.
      ...(data.accountNumber !== undefined
        ? { accountNumber: encryptSearchable(data.accountNumber) }
        : {}),
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Balance & Withdraw (real Paystack payouts — no internal wallet ledger)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Net vendor earnings, paid-out totals, and the resulting available balance.
 *
 * Available balance = (sum of every completed order's real vendor earning)
 *                    − (sum of completed payout amounts)
 *                    − (sum of payouts currently in flight/"initiated")
 *
 * "Real vendor earning" per order = subtotal − fee, using the genuine
 * commission breakdown persisted at checkout time (see
 * payment.service.ts#initializeCheckout). For historical rows that predate
 * that fix (subtotal/fee null), we fall back to tx.amount — i.e. we treat the
 * old (mislabeled) `amount` as if it were already net, exactly like the
 * legacy fallback in getVendorTransactionById above, so the balance always
 * agrees with what a vendor sees on any individual old transaction's detail
 * screen. Payouts (withdrawals) are ledgered as type "payment" against the
 * vendor, mirroring the rider payout convention in rider.service.ts.
 */
// Prisma client or an in-flight $transaction callback client — lets the core
// balance computation below be reused both for a plain read (getVendorBalance)
// and re-checked atomically inside a Serializable transaction
// (withdrawVendorFunds), so both paths compute the exact same numbers off the
// exact same query shape.
type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

const _computeVendorAvailableBalance = async (
  client: PrismaClientOrTx,
  vendorId: string,
) => {
  const [newEarningsAgg, legacyEarningsAgg, paidOutAgg, pendingAgg, commission] =
    await Promise.all([
      // New-style rows: real subtotal/fee were persisted at creation.
      client.transaction.aggregate({
        where: {
          vendorId,
          type: "order",
          status: "completed",
          subtotal: { not: null },
        },
        _sum: { subtotal: true, fee: true },
      }),
      // Legacy rows: subtotal/fee were never populated — fall back to amount
      // (see comment above / getVendorTransactionById's identical fallback).
      client.transaction.aggregate({
        where: {
          vendorId,
          type: "order",
          status: "completed",
          subtotal: null,
        },
        _sum: { amount: true },
      }),
      // Completed payouts already sent to the vendor's bank via Paystack.
      client.transaction.aggregate({
        where: { vendorId, type: "payment", status: "completed" },
        _sum: { amount: true },
      }),
      // Payouts currently in flight — earmarked so a second withdraw request
      // can't double-spend the same balance while the first is processing.
      client.transaction.aggregate({
        where: { vendorId, type: "payment", status: "initiated" },
        _sum: { amount: true },
      }),
      cfg.fees.vendorCommission(),
    ]);

  const newSubtotal = newEarningsAgg._sum.subtotal ?? 0;
  const newFee = newEarningsAgg._sum.fee ?? 0;
  const legacyEarnings = legacyEarningsAgg._sum.amount ?? 0;

  const totalEarned = newSubtotal - newFee + legacyEarnings;
  const totalWithdrawn = paidOutAgg._sum.amount ?? 0;
  const pendingBalance = pendingAgg._sum.amount ?? 0;

  const availableBalance = Math.max(
    0,
    totalEarned - totalWithdrawn - pendingBalance,
  );

  return {
    totalEarned,
    totalWithdrawn,
    pendingBalance,
    availableBalance,
    commissionRate: commission,
  };
};

export const getVendorBalance = async (userId: string) => {
  const vendor = await _requireVendor(userId);

  const { totalEarned, totalWithdrawn, pendingBalance, availableBalance, commissionRate } =
    await _computeVendorAvailableBalance(prisma, vendor.id);

  // A handful of recent transactions for the earnings screen's context —
  // mirrors the shape getVendorTransactions already formats.
  const recent = await prisma.transaction.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const recentTransactions = recent.map((tx) => ({
    ...tx,
    formattedAmount: `₦${tx.amount.toLocaleString()}`,
    formattedDate: tx.createdAt.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    }),
    formattedTime: tx.createdAt.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
    iconBg:
      tx.type === "payment" || tx.type === "order" ? "#FEF3F2" : "#ECFDF5",
  }));

  return {
    totalEarned,
    totalWithdrawn,
    pendingBalance,
    availableBalance,
    commissionRate,
    recentTransactions,
  };
};

const WITHDRAW_RETRY_DELAYS_MS = [1_000, 3_000, 7_000];

/**
 * Withdraw a vendor's available balance to one of their bank accounts via a
 * real Paystack transfer — the vendor-side equivalent of rider.service.ts's
 * _disburseRiderEarnings. Unlike the rider payout (fired automatically,
 * fire-and-forget, right after a delivery completes), this is a synchronous,
 * on-demand request the vendor explicitly triggers, so we await the whole
 * recipient-creation + transfer + retry chain and return its outcome instead
 * of leaving the caller to poll.
 */
export const withdrawVendorFunds = async (
  userId: string,
  amount: number,
  bankAccountId: string,
) => {
  const vendor = await _requireVendor(userId);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw AppError.badRequest("Enter a valid withdrawal amount.");
  }

  const bankAccount = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, vendorId: vendor.id },
  });
  if (!bankAccount) throw AppError.notFound("Bank account");

  // Atomically re-check the balance and claim the withdrawal row inside a
  // single Serializable transaction. Without this, two concurrent withdraw
  // requests could both read the same pre-withdrawal balance, both pass the
  // `amount > availableBalance` check, and both create an "initiated" payout
  // row — a double-spend. Serializable isolation guarantees the DB itself
  // will abort one of two concurrent transactions that would otherwise
  // interleave unsafely, and re-running the balance computation *inside* the
  // transaction (instead of trusting the pre-transaction read above) means
  // the second transaction to actually run sees the first one's earmarked
  // "initiated" row and correctly fails the balance check.
  const tx = await prisma.$transaction(
    async (txClient) => {
      const { availableBalance } = await _computeVendorAvailableBalance(
        txClient,
        vendor.id,
      );
      if (amount > availableBalance) {
        throw AppError.badRequest("Amount exceeds your available balance.");
      }

      // Ledger row created up front, "initiated" — this is what
      // _computeVendorAvailableBalance earmarks against so a second
      // concurrent withdraw can't also spend this same balance while the
      // transfer below is still in flight.
      return txClient.transaction.create({
        data: {
          vendorId: vendor.id,
          type: "payment",
          status: "initiated",
          title: "Vendor Payout",
          amount,
          paymentMethod: "bank_transfer",
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  // Same retry/backoff structure as _disburseRiderEarnings: three attempts at
  // 1s / 3s / 7s. If all three fail, the row is marked "failed" (rather than
  // silently left "initiated") so it's unambiguous the payout needs manual
  // investigation/retry, and the vendor's balance is no longer earmarked
  // against it (a "failed" row is excluded from the pending-balance sum).
  let lastError: string = "Paystack transfer error";
  for (let attempt = 0; attempt <= WITHDRAW_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const recipientRes = await ps.post("/transferrecipient", {
        type: "nuban",
        name: bankAccount.accountName,
        account_number: decrypt(bankAccount.accountNumber),
        bank_code: bankAccount.bankCode,
        currency: "NGN",
      });

      const recipientCode = recipientRes.data.data.recipient_code;

      const transferRes = await ps.post("/transfer", {
        source: "balance",
        amount: Math.round(amount * 100), // Kobo
        recipient: recipientCode,
        reason: `Rave vendor payout - ${vendor.storeName ?? vendor.id}`,
      });

      const transferCode = transferRes.data.data.transfer_code;

      const completed = await prisma.transaction.update({
        where: { id: tx.id },
        data: { status: "completed", reference: transferCode },
      });

      await notif.notifyVendorWithdrawalCompleted(userId, amount);

      return {
        status: "completed" as const,
        transactionId: completed.id,
        reference: transferCode,
      };
    } catch (err: any) {
      lastError =
        err?.response?.data?.message ??
        err?.message ??
        "Paystack transfer error";

      if (attempt === WITHDRAW_RETRY_DELAYS_MS.length) {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { status: "failed", reason: lastError },
        });
        await notif.notifyVendorWithdrawalFailed(userId, amount, lastError);
        throw AppError.badRequest(
          `Withdrawal could not be completed: ${lastError}. Please try again shortly.`,
        );
      }

      const waitMs = WITHDRAW_RETRY_DELAYS_MS[attempt];
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  // Unreachable — the loop above always returns or throws.
  throw AppError.badRequest(`Withdrawal failed: ${lastError}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Refunds — vendor-facing approve/decline (first line of resolution; admins
// can also force-approve/decline any refund via admin/refundAdmin.service.ts,
// which shares the same Paystack-refund core in shared/refundProcessing.service.ts)
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorRefunds = async (
  userId: string,
  query: PaginationQuery & { status?: string },
) => {
  const vendor = await _requireVendor(userId);
  const { page, limit, skip } = parsePagination(query);

  const where = {
    order: { vendorId: vendor.id },
    ...(query.status && query.status !== "all"
      ? { status: query.status as any }
      : {}),
  };

  const [refunds, total] = await Promise.all([
    prisma.refundRequest.findMany({
      where,
      include: {
        items: true,
        order: { select: { orderId: true } },
        user: { select: { fullName: true, imageUrl: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.refundRequest.count({ where }),
  ]);

  return {
    refunds: refunds.map((r) => ({
      id: r.id,
      orderId: r.order.orderId,
      customerName: r.user.fullName,
      customerImage: r.user.imageUrl,
      issue: r.issue,
      description: r.description,
      status: r.status,
      amountRequested: r.amountRequested,
      amountApproved: r.amountApproved,
      updateMessage: r.updateMessage,
      items: r.items.map((i) => ({ name: i.name, qty: i.qty })),
      createdAt: r.createdAt,
    })),
    meta: buildMeta(total, page, limit),
  };
};

// Scoped the same way every other vendor read/write in this file is: resolve
// the vendor's own profile, then require the target row join back to a
// vendorId match — here via RefundRequest → Order → vendorId, so a vendor can
// never act on another store's refund requests.
const _requireVendorOwnedRefund = async (userId: string, refundId: string) => {
  const vendor = await _requireVendor(userId);
  const refund = await prisma.refundRequest.findFirst({
    where: { id: refundId, order: { vendorId: vendor.id } },
    include: { order: true },
  });
  if (!refund) throw AppError.notFound("Refund request");
  return refund;
};

export const approveRefundRequest = async (
  userId: string,
  refundId: string,
): Promise<void> => {
  const refund = await _requireVendorOwnedRefund(userId, refundId);
  await refundProcessing.processRefundApproval(refund);
};

export const declineRefundRequest = async (
  userId: string,
  refundId: string,
  reason?: string,
): Promise<void> => {
  const refund = await _requireVendorOwnedRefund(userId, refundId);
  await refundProcessing.processRefundDecline(refund, reason);
};
