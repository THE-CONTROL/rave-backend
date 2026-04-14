// src/services/catalog.service.ts
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import {
  buildMeta,
  parsePagination,
  haversineKm,
  formatDistance,
  estimateEtaMinutes,
} from "../utils";
import { PaginationQuery } from "../types";
import { cfg } from "./config.service";

// ─────────────────────────────────────────────────────────────────────────────
// Restaurants (public)
// ─────────────────────────────────────────────────────────────────────────────

export const getNearbyRestaurants = async (
  query: PaginationQuery & {
    radiusKm?: string;
    isOpen?: string;
    hasFreeDelivery?: string;
    minRating?: string;
  },
  userId?: string | null,
) => {
  const { page, limit, skip } = parsePagination(query);
  const radiusKm = query.radiusKm ? parseFloat(query.radiusKm) : 10;

  // ── User coordinates from default address ─────────────────────────────────
  let userLat: number | null = null;
  let userLng: number | null = null;

  if (userId) {
    const defaultAddress = await prisma.address.findFirst({
      where: { userId, isDefault: true },
      select: { lat: true, lng: true },
    });
    if (!defaultAddress?.lat || !defaultAddress?.lng) {
      const anyAddress = await prisma.address.findFirst({
        where: { userId, lat: { not: null }, lng: { not: null } },
        select: { lat: true, lng: true },
        orderBy: { createdAt: "desc" },
      });
      userLat = anyAddress?.lat ?? null;
      userLng = anyAddress?.lng ?? null;
    } else {
      userLat = defaultAddress.lat;
      userLng = defaultAddress.lng;
    }

    // Authenticated users must have a geocoded address — we cannot sort by
    // proximity without coordinates, and showing an unordered list is misleading.
    if (userLat === null || userLng === null) {
      throw AppError.badRequest(
        "Please add a delivery address before browsing nearby restaurants.",
      );
    }
  }

  // ── User's usual vendors ───────────────────────────────────────────────────
  const usualVendorIds = new Set<string>();
  if (userId) {
    const usualOrders = await prisma.order.findMany({
      where: { userId, status: "completed" },
      select: { vendorId: true },
      distinct: ["vendorId"],
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    usualOrders.forEach((o) => usualVendorIds.add(o.vendorId));
  }

  // ── Build filter where clause ──────────────────────────────────────────────
  const where: any = {
    // storeStatus: "open",
    // ...(query.isOpen === "true" ? { isOpen: true } : {}),
  };

  const vendors = await prisma.vendorProfile.findMany({
    where,
    select: {
      id: true,
      storeName: true,
      logoUrl: true,
      bannerUrl: true,
      isOpen: true,
      averageRating: true,
      totalReviews: true,
      // hasFreeDelivery: true,
      address: true,
      lat: true,
      lng: true,
      positiveReviews: true,
      // deliveryTimeMin: true,
      hoursSummary: true,
      favoriteRestaurants: userId
        ? { where: { userId }, select: { userId: true } }
        : false,
    },
  });

  // ── Attach distance ────────────────────────────────────────────────────────
  const withDistance = vendors.map((v) => {
    const distanceKm =
      userLat !== null && userLng !== null && v.lat && v.lng
        ? haversineKm(userLat, userLng, v.lat, v.lng)
        : null;
    return { ...v, distanceKm };
  });

  // ── Filter by radius when coords available ─────────────────────────────────
  const filtered =
    userLat !== null
      ? withDistance.filter(
          (v) => v.distanceKm === null || v.distanceKm <= radiusKm,
        )
      : withDistance;

  // ── Sort: nearest first, then by rating ───────────────────────────────────
  const sorted = filtered.sort((a, b) => {
    if (a.distanceKm !== null && b.distanceKm !== null)
      return a.distanceKm - b.distanceKm;
    return b.averageRating - a.averageRating;
  });

  const total = sorted.length;
  const paginated = sorted.slice(skip, skip + limit);
  const deliveryBase = await cfg.fees.deliveryBase();

  return {
    vendors: paginated.map((v) => ({
      id: v.id,
      name: v.storeName,
      image: v.bannerUrl,
      logo: v.logoUrl,
      rating: v.averageRating,
      reviewCount: v.totalReviews,
      isOpen: v.isOpen,
      address: v.address,
      distanceKm: v.distanceKm,
      distanceLabel:
        v.distanceKm !== null ? formatDistance(v.distanceKm) : null,
      deliveryTime:
        v.distanceKm !== null
          ? `${estimateEtaMinutes(v.distanceKm)}–${estimateEtaMinutes(v.distanceKm) + 10} mins`
          : `${30} mins`,
      deliveryFee: deliveryBase,
      positiveReviews: v.positiveReviews,
      hasFreeDelivery: false,
      closesIn: v.hoursSummary ?? null,
      isYourUsual: usualVendorIds.has(v.id),
      isFavorite: userId ? (v.favoriteRestaurants as any[])?.length > 0 : false,
    })),
    meta: buildMeta(total, page, limit),
    locationUsed:
      userLat !== null
        ? { lat: userLat, lng: userLng, source: "saved_address" }
        : null,
  };
};

export const getRestaurantDetails = async (
  vendorId: string,
  userId?: string,
) => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    include: {
      storeSchedules: true,
      _count: { select: { menuItems: true, reviewsReceived: true } },
    },
  });
  if (!vendor) throw AppError.notFound("Restaurant");

  let isFavorite = false;
  if (userId) {
    const fav = await prisma.favoriteRestaurant.findUnique({
      where: { userId_vendorId: { userId, vendorId } },
    });
    isFavorite = !!fav;
  }

  return { ...vendor, isFavorite };
};

export const getRestaurantMenu = async (
  vendorId: string,
  categoryId?: string,
) => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
  });
  if (!vendor) throw AppError.notFound("Restaurant");

  const items = await prisma.menuItem.findMany({
    where: {
      vendorId,
      isActive: true,
      ...(categoryId ? { categories: { some: { categoryId } } } : {}),
    },
    include: { categories: { include: { category: true } } },
    orderBy: [{ isBestSeller: "desc" }, { name: "asc" }],
  });

  return items;
};

export const getRestaurantCategories = (vendorId: string) =>
  prisma.category.findMany({
    where: { vendorId, isActive: true },
    include: { _count: { select: { menuItems: true } } },
  });

export const getRestaurantReviews = async (
  vendorId: string,
  query: PaginationQuery & { rating?: string },
) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    vendorId,
    ...(query.rating
      ? { restaurantRating: { gte: Number(query.rating) } }
      : {}),
  };

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where,
      include: {
        user: { select: { fullName: true, imageUrl: true } },
        order: { select: { createdAt: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.review.count({ where }),
  ]);

  const shaped = reviews.map((r) => ({
    id: r.id,
    customerName: r.user.fullName,
    customerImage: r.user.imageUrl,
    rating: r.restaurantRating,
    date: r.createdAt.toISOString(),
    comment: r.comment ?? "",
    verified: r.isVerified,
    orderDate: r.order?.createdAt.toISOString() ?? null,
    proofUrls: r.proofUrls ?? [],
  }));

  return { reviews: shaped, meta: buildMeta(total, page, limit) };
};

// ─────────────────────────────────────────────────────────────────────────────
// Products (menu items - public)
// ─────────────────────────────────────────────────────────────────────────────

export const getProductDetails = async (
  menuItemId: string,
  userId?: string,
) => {
  const item = await prisma.menuItem.findUnique({
    where: { id: menuItemId, isActive: true },
    include: {
      vendor: {
        select: {
          id: true,
          storeName: true,
          logoUrl: true,
          isOpen: true,
          averageRating: true,
        },
      },
      categories: { include: { category: true } },
      customGroups: { include: { options: true } },
    },
  });
  if (!item) throw AppError.notFound("Product");

  let isFavorite = false;
  if (userId) {
    const fav = await prisma.favoriteProduct.findUnique({
      where: { userId_menuItemId: { userId, menuItemId } },
    });
    isFavorite = !!fav;
  }

  // Reviews now store menuItemIds as a plain String[] — use `has` filter
  const reviewStats = await prisma.review.aggregate({
    where: { menuItemIds: { has: menuItemId } },
    _avg: { foodRating: true },
    _count: { id: true },
  });

  return {
    ...item,
    isFavorite,
    rating: parseFloat((reviewStats._avg.foodRating ?? 0).toFixed(1)),
    reviewCount: reviewStats._count.id,
  };
};

export const getProductReviews = async (
  menuItemId: string,
  query: PaginationQuery,
) => {
  const { page, limit, skip } = parsePagination(query);
  const where = { menuItemIds: { has: menuItemId } };

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
// Search
// ─────────────────────────────────────────────────────────────────────────────

export const search = async (
  q: string,
  type: "restaurants" | "foods" | "all",
  query: PaginationQuery,
  userId?: string,
) => {
  const { page, limit, skip } = parsePagination(query);
  const searchTerm = q.trim();

  if (!searchTerm)
    return { restaurants: [], foods: [], meta: buildMeta(0, page, limit) };

  // Save to search history — fire and forget
  if (userId && searchTerm.length >= 2) {
    prisma.searchHistory
      .create({ data: { userId, query: searchTerm } })
      .catch(() => {});
  }

  const results: Record<string, unknown> = {};

  if (type === "restaurants" || type === "all") {
    results.restaurants = await prisma.vendorProfile.findMany({
      where: {
        storeName: { contains: searchTerm, mode: "insensitive" },
      },
      select: {
        id: true,
        storeName: true,
        logoUrl: true,
        isOpen: true,
        averageRating: true,
        address: true,
      },
      skip,
      take: limit,
    });
  }

  if (type === "foods" || type === "all") {
    results.foods = await prisma.menuItem.findMany({
      where: {
        isActive: true,
        name: { contains: searchTerm, mode: "insensitive" },
      },
      include: {
        vendor: { select: { id: true, storeName: true, logoUrl: true } },
      },
      skip,
      take: limit,
    });
  }

  return { ...results, meta: buildMeta(0, page, limit) };
};

// ─────────────────────────────────────────────────────────────────────────────
// Categories (global browse)
// ─────────────────────────────────────────────────────────────────────────────

export const getFoodCategories = () =>
  prisma.category.findMany({
    where: { isActive: true },
    distinct: ["name"],
    select: { id: true, name: true, imageUrl: true },
    orderBy: { name: "asc" },
  });

export const getItemsByCategory = async (
  categoryName: string,
  query: PaginationQuery & {
    minPrice?: string;
    maxPrice?: string;
    isBestSeller?: string;
  },
) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    isActive: true,
    categories: {
      some: {
        category: {
          name: { contains: categoryName, mode: "insensitive" as const },
        },
      },
    },
    ...(query.minPrice ? { price: { gte: parseFloat(query.minPrice) } } : {}),
    ...(query.maxPrice
      ? {
          price: {
            ...(query.minPrice ? { gte: parseFloat(query.minPrice) } : {}),
            lte: parseFloat(query.maxPrice),
          },
        }
      : {}),
    ...(query.isBestSeller === "true" ? { isBestSeller: true } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.menuItem.findMany({
      where,
      include: {
        vendor: { select: { id: true, storeName: true, logoUrl: true } },
      },
      orderBy: [{ isBestSeller: "desc" }, { name: "asc" }],
      skip,
      take: limit,
    }),
    prisma.menuItem.count({ where }),
  ]);

  return { items, meta: buildMeta(total, page, limit) };
};

// ─────────────────────────────────────────────────────────────────────────────
// Breakfast picks & home screen helpers
// ─────────────────────────────────────────────────────────────────────────────

export const getBreakfastPicks = async (
  opts: { userId?: string; radiusKm?: string } = {},
) => {
  const radiusKm = opts.radiusKm ? parseFloat(opts.radiusKm) : 10;

  // ── Resolve user coordinates from saved address (same as getNearbyRestaurants) ──
  let userLat: number | null = null;
  let userLng: number | null = null;

  if (opts.userId) {
    const defaultAddress = await prisma.address.findFirst({
      where: { userId: opts.userId, isDefault: true },
      select: { lat: true, lng: true },
    });
    if (!defaultAddress?.lat || !defaultAddress?.lng) {
      const anyAddress = await prisma.address.findFirst({
        where: { userId: opts.userId, lat: { not: null }, lng: { not: null } },
        select: { lat: true, lng: true },
        orderBy: { createdAt: "desc" },
      });
      userLat = anyAddress?.lat ?? null;
      userLng = anyAddress?.lng ?? null;
    } else {
      userLat = defaultAddress.lat;
      userLng = defaultAddress.lng;
    }

    if (userLat === null || userLng === null) {
      throw AppError.badRequest(
        "Please add a delivery address before browsing nearby restaurants.",
      );
    }
  }

  const deliveryBase = await cfg.fees.deliveryBase();

  const items = await prisma.menuItem.findMany({
    where: {
      isActive: true,
      vendor: { isOpen: true, storeStatus: "open" },
      categories: {
        some: {
          category: { name: { contains: "Breakfast", mode: "insensitive" } },
        },
      },
    },
    include: {
      vendor: {
        select: {
          id: true,
          storeName: true,
          logoUrl: true,
          isOpen: true,
          averageRating: true,
          totalReviews: true,
          // hasFreeDelivery: true,
          // deliveryTimeMin: true,
          lat: true,
          lng: true,
        },
      },
      categories: { include: { category: true } },
      favorites: opts.userId ? { where: { userId: opts.userId } } : false,
      _count: { select: { orderItems: true } },
    },
    orderBy: [{ isBestSeller: "desc" }],
    take: 50, // fetch more so we have enough after proximity filter
  });

  // ── Filter by radius if user location is known ────────────────────────────
  const filtered =
    userLat !== null && userLng !== null
      ? items.filter((item) => {
          if (!item.vendor.lat || !item.vendor.lng) return true;
          return (
            haversineKm(userLat!, userLng!, item.vendor.lat, item.vendor.lng) <=
            radiusKm
          );
        })
      : items;

  // ── Sort: bestsellers first, then by proximity ────────────────────────────
  const sorted = filtered.sort((a, b) => {
    if (a.isBestSeller && !b.isBestSeller) return -1;
    if (!a.isBestSeller && b.isBestSeller) return 1;
    if (userLat !== null && userLng !== null) {
      const dA =
        a.vendor.lat && a.vendor.lng
          ? haversineKm(userLat, userLng, a.vendor.lat, a.vendor.lng)
          : 999;
      const dB =
        b.vendor.lat && b.vendor.lng
          ? haversineKm(userLat, userLng, b.vendor.lat, b.vendor.lng)
          : 999;
      return dA - dB;
    }
    return b._count.orderItems - a._count.orderItems;
  });

  return sorted.slice(0, 20).map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    price: item.price,
    imageUrl: item.imageUrl,
    isBestSeller: item.isBestSeller,
    calories: item.calories,
    prepTime: item.prepTime,
    serves: item.serves,
    orderCount: item._count.orderItems,
    isFavorite: opts.userId ? (item.favorites as any[])?.length > 0 : false,
    categories: item.categories.map((c) => c.category.name),
    vendor: {
      id: item.vendor.id,
      storeName: item.vendor.storeName,
      logoUrl: item.vendor.logoUrl,
      isOpen: item.vendor.isOpen,
      averageRating: item.vendor.averageRating,
      totalReviews: item.vendor.totalReviews,
      hasFreeDelivery: false,
      deliveryFee: deliveryBase,
      deliveryTime: "30–40 mins",
    },
  }));
};

export const getRatingDistribution = async (vendorId: string) => {
  const reviews = await prisma.review.findMany({
    where: { vendorId },
    select: { restaurantRating: true },
  });

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of reviews) {
    const star = Math.round(r.restaurantRating);
    if (star >= 1 && star <= 5) distribution[star]++;
  }

  return {
    total: reviews.length,
    distribution,
  };
};
