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

// ─────────────────────────────────────────────────────────────────────────────
// Restaurants (public)
// ─────────────────────────────────────────────────────────────────────────────

export const getRestaurantDetails = async (
  vendorId: string,
  userId?: string,
) => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    include: {
      schedules: true,
      _count: {
        select: {
          menuItems: true,
          reviewsReceived: true,
        },
      },
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
  userId?: string | null,
  categoryId?: string,
) => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: {
      id: true,
      storeName: true,
      logoUrl: true,
      isOpen: true,
      averageRating: true,
    },
  });

  if (!vendor) throw AppError.notFound("Restaurant");

  const items = await prisma.menuItem.findMany({
    where: {
      vendorId,
      isActive: true,
      ...(categoryId ? { categories: { some: { categoryId } } } : {}),
    },
    include: {
      categories: {
        include: { category: { select: { id: true, name: true } } },
      },
      images: true,
      ingredients: true,
      favorites: userId ? { where: { userId } } : false,
    },
    orderBy: [{ isBestSeller: "desc" }, { name: "asc" }],
  });

  return items.map((item) => {
    // ── customGroups from optional ingredients grouped by mealType ────────
    const optionalIngredients = item.ingredients.filter(
      (ing) => ing.isOptional,
    );
    const groupMap = new Map<string, typeof optionalIngredients>();
    for (const ing of optionalIngredients) {
      const key = ing.mealType || "Add-ons";
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(ing);
    }
    const customGroups = Array.from(groupMap.entries()).map(
      ([mealType, ings]) => ({
        id: mealType,
        title: mealType,
        type: "optional",
        required: false,
        options: ings.map((ing) => ({
          id: ing.id,
          name: ing.name,
          extraPrice: ing.price ?? 0,
        })),
      }),
    );

    return {
      id: item.id,
      name: item.name,
      description: item.description ?? null,
      price: item.price,
      isActive: item.isActive,
      isBestSeller: item.isBestSeller,
      isCustomizable: item.isCustomizable,
      images: item.images.map((img) => ({
        id: img.id,
        url: img.url,
        isMain: img.isMain,
      })),
      ingredients: item.ingredients.map((ing) => ({
        id: ing.id,
        name: ing.name,
        portion: ing.portion,
        mealType: ing.mealType,
        isOptional: ing.isOptional,
        price: ing.price ?? 0,
      })),
      // Rating comes from the vendor's overall rating since
      // MenuItem has no direct reviews relation
      rating: vendor.averageRating,
      reviewCount: 0,
      isFavorite: userId ? (item.favorites as any[]).length > 0 : false,
      vendor: {
        id: vendor.id,
        storeName: vendor.storeName,
        logoUrl: vendor.logoUrl ?? null,
        isOpen: vendor.isOpen,
        averageRating: vendor.averageRating,
      },
      categories: item.categories.map((c) => ({
        category: {
          id: c.category.id,
          name: c.category.name,
        },
      })),
      customGroups,
    };
  });
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
    const vendors = await prisma.vendorProfile.findMany({
      where: {
        storeName: { contains: searchTerm, mode: "insensitive" },
      },
      select: {
        id: true,
        storeName: true,
        logoUrl: true,
        bannerUrl: true,
        isOpen: true,
        averageRating: true,
        totalReviews: true,
        address: true,
        positiveReviews: true,
      },
      skip,
      take: limit,
    });

    results.restaurants = vendors.map((v) => ({
      id: v.id,
      name: v.storeName,
      image: v.bannerUrl ?? null,
      logo: v.logoUrl ?? null,
      rating: v.averageRating,
      reviewCount: v.totalReviews,
      isOpen: v.isOpen,
      address: v.address ?? null,
      positiveReviews: v.positiveReviews,
      distanceKm: null,
      distanceLabel: null,
      closesIn: null,
      isYourUsual: false,
      isFavorite: false,
      deliveryTime: "25-35 mins",
    }));
  }

  if (type === "foods" || type === "all") {
    const foods = await prisma.menuItem.findMany({
      where: {
        isActive: true,
        name: { contains: searchTerm, mode: "insensitive" },
      },
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
        images: { orderBy: { isMain: "desc" } },
        ingredients: true,
        categories: {
          include: { category: { select: { id: true, name: true } } },
        },
      },
      skip,
      take: limit,
    });

    results.foods = foods.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      price: f.price,
      isActive: f.isActive,
      isBestSeller: f.isBestSeller,
      isCustomizable: f.isCustomizable,
      images: f.images.map((img) => ({
        id: img.id,
        url: img.url,
        isMain: img.isMain,
      })),
      ingredients: f.ingredients.map((ing) => ({
        id: ing.id,
        name: ing.name,
        portion: ing.portion,
        mealType: ing.mealType,
        isOptional: ing.isOptional,
        price: ing.price ?? 0,
      })),
      rating: 0,
      reviewCount: 0,
      isFavorite: false,
      vendor: {
        id: f.vendor.id,
        storeName: f.vendor.storeName,
        logoUrl: f.vendor.logoUrl,
        isOpen: f.vendor.isOpen,
        averageRating: f.vendor.averageRating,
      },
      categories: f.categories,
      customGroups: [],
    }));
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// Restaurants (public)
// ─────────────────────────────────────────────────────────────────────────────

export const getNearbyRestaurants = async (
  query: PaginationQuery & {
    radiusKm?: string;
    isOpen?: string;
    minRating?: string;
  },
  userId?: string | null,
) => {
  const { page, limit, skip } = parsePagination(query);
  const radiusKm = query.radiusKm ? parseFloat(query.radiusKm) : 10;

  // ── User coordinates from default location ─────────────────────────────────
  let userLat: number | null = null;
  let userLng: number | null = null;

  if (userId) {
    const defaultLocation = await prisma.savedLocation.findFirst({
      where: { userId, isDefault: true },
      select: { latitude: true, longitude: true },
    });

    const locationSource =
      defaultLocation ||
      (await prisma.savedLocation.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }));

    userLat = locationSource?.latitude ?? null;
    userLng = locationSource?.longitude ?? null;

    if (userLat === null || userLng === null) {
      throw AppError.badRequest("Please add a delivery location first.");
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
      take: 10,
    });
    usualOrders.forEach((o) => usualVendorIds.add(o.vendorId));
  }

  // ── Build filter where clause ──────────────────────────────────────────────
  const where: any = {
    ...(query.isOpen === "true" ? { isOpen: true } : {}),
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
      address: true,
      lat: true,
      lng: true,
      positiveReviews: true,
      hoursSummary: true,
    },
  });

  const withDistance = vendors.map((v) => {
    const distanceKm =
      userLat !== null && userLng !== null && v.lat && v.lng
        ? haversineKm(userLat, userLng, v.lat, v.lng)
        : null;
    return { ...v, distanceKm };
  });

  const filtered =
    userLat !== null
      ? withDistance.filter(
          (v) => v.distanceKm === null || v.distanceKm <= radiusKm,
        )
      : withDistance;

  // Sort: Nearest first, then best rated
  const sorted = filtered.sort((a, b) => {
    if (
      a.distanceKm !== null &&
      b.distanceKm !== null &&
      Math.abs(a.distanceKm - b.distanceKm) > 0.1
    )
      return a.distanceKm - b.distanceKm;
    return b.averageRating - a.averageRating;
  });

  const total = sorted.length;
  const paginated = sorted.slice(skip, skip + limit);

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
          ? `${estimateEtaMinutes(v.distanceKm)} mins`
          : "30 mins",
      positiveReviews: v.positiveReviews,
      closesIn: v.hoursSummary,
      isYourUsual: usualVendorIds.has(v.id),
    })),
    meta: buildMeta(total, page, limit),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Products (menu items)
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
      images: true, // New relation for multiple images
      categories: { include: { category: true } },
      ingredients: true, // Now uses MenuItemIngredient model
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

  const reviewStats = await prisma.review.aggregate({
    where: { menuItemIds: { has: menuItemId } },
    _avg: { foodRating: true },
    _count: { id: true },
  });

  // Map to frontend Product interface
  return {
    ...item,
    imageUrl:
      item.images.find((img) => img.isMain)?.url || item.images[0]?.url || null,
    isFavorite,
    rating: parseFloat((reviewStats._avg.foodRating ?? 0).toFixed(1)),
    reviewCount: reviewStats._count.id,
    ingredients: item.ingredients.map((ing) => ({
      ...ing,
      price: ing.isOptional ? ing.price : 0, // Ensure safety
    })),
  };
};

export const getBreakfastPicks = async (
  opts: { userId?: string; radiusKm?: string } = {},
) => {
  const radiusKm = opts.radiusKm ? parseFloat(opts.radiusKm) : 10;
  let userLat: number | null = null;
  let userLng: number | null = null;

  if (opts.userId) {
    const loc = await prisma.savedLocation.findFirst({
      where: { userId: opts.userId, isDefault: true },
    });
    userLat = loc?.latitude ?? null;
    userLng = loc?.longitude ?? null;
  }

  const items = await prisma.menuItem.findMany({
    where: {
      isActive: true,
      vendor: { isOpen: true },
      categories: {
        some: {
          category: { name: { contains: "Breakfast", mode: "insensitive" } },
        },
      },
    },
    include: {
      vendor: true,
      images: { where: { isMain: true }, take: 1 },
      favorites: opts.userId ? { where: { userId: opts.userId } } : false,
      _count: { select: { orderItems: true } },
    },
    orderBy: { isBestSeller: "desc" },
    take: 40,
  });

  const filtered =
    userLat !== null && userLng !== null
      ? items.filter(
          (i) =>
            !i.vendor.lat ||
            haversineKm(
              userLat!,
              userLng!,
              i.vendor.lat,
              i.vendor.lng as number,
            ) <= radiusKm,
        )
      : items;

  return filtered.slice(0, 15).map((item) => ({
    id: item.id,
    name: item.name,
    price: item.price,
    images: item.images,
    isBestSeller: item.isBestSeller,
    isFavorite: opts.userId ? (item.favorites as any[])?.length > 0 : false,
    vendor: {
      id: item.vendor.id,
      storeName: item.vendor.storeName,
      averageRating: item.vendor.averageRating,
    },
  }));
};

export const getAllVendors = async (
  query: PaginationQuery,
  userId?: string | null,
) => {
  const { page, limit, skip } = parsePagination(query);

  // 1. Identify User's Usuals (Keep logic as it adds personalized context to the full list)
  const usualVendorIds = new Set<string>();
  if (userId) {
    const usualOrders = await prisma.order.findMany({
      where: { userId, status: "completed" },
      select: { vendorId: true },
      distinct: ["vendorId"],
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    usualOrders.forEach((o) => usualVendorIds.add(o.vendorId));
  }

  // 2. Fetch Everything (Empty where clause)
  const where: any = {};

  const [vendors, total] = await Promise.all([
    prisma.vendorProfile.findMany({
      where,
      select: {
        id: true,
        storeName: true,
        logoUrl: true,
        bannerUrl: true,
        isOpen: true,
        averageRating: true,
        totalReviews: true,
        address: true,
        positiveReviews: true,
        hoursSummary: true,
      },
      orderBy: { averageRating: "desc" },
      skip,
      take: limit,
    }),
    prisma.vendorProfile.count({ where }),
  ]);

  return {
    data: {
      vendors: vendors.map((v) => ({
        id: v.id,
        name: v.storeName,
        image: v.bannerUrl,
        logo: v.logoUrl,
        rating: v.averageRating,
        reviewCount: v.totalReviews,
        isOpen: v.isOpen,
        address: v.address,
        positiveReviews: v.positiveReviews,
        closesIn: v.hoursSummary,
        isYourUsual: usualVendorIds.has(v.id),
      })),
    },
    meta: buildMeta(total, page, limit),
  };
};

export const getAllMenuItems = async (
  query: PaginationQuery,
  userId?: string | null,
) => {
  const { page, limit, skip } = parsePagination(query);

  // Fetch Everything (Empty where clause)
  const where: any = {};

  const [items, total] = await Promise.all([
    prisma.menuItem.findMany({
      where,
      include: {
        vendor: {
          select: {
            id: true,
            storeName: true,
            averageRating: true,
          },
        },
        images: { where: { isMain: true }, take: 1 },
        favorites: userId ? { where: { userId } } : false,
      },
      orderBy: { isBestSeller: "desc" },
      skip,
      take: limit,
    }),
    prisma.menuItem.count({ where }),
  ]);

  return {
    data: {
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        images: item.images || null,
        isBestSeller: item.isBestSeller,
        isFavorite: userId ? (item.favorites as any[]).length > 0 : false,
        vendor: {
          id: item.vendor.id,
          storeName: item.vendor.storeName,
          averageRating: item.vendor.averageRating,
        },
      })),
    },
    meta: buildMeta(total, page, limit),
  };
};
