// src/services/catalog.service.ts
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import {
  buildMeta,
  parsePagination,
  haversineKm,
  formatDistance,
  estimateEtaMinutes,
  pickReviewTags,
} from "../utils";
import { PaginationQuery } from "../types";
import { cfg } from "./config.service";

const tzlookup = require("tz-lookup");

// ─────────────────────────────────────────────────────────────────────────────
// Restaurants (public)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a user's current delivery coordinates from their saved locations
 * (default first, else most recent). Returns nulls when the user has no
 * location yet, so callers can fall back gracefully.
 */
const _resolveUserCoords = async (
  userId?: string | null,
): Promise<{ lat: number | null; lng: number | null }> => {
  if (!userId) return { lat: null, lng: null };
  const loc =
    (await prisma.savedLocation.findFirst({
      where: { userId, isDefault: true },
      select: { latitude: true, longitude: true },
    })) ??
    (await prisma.savedLocation.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { latitude: true, longitude: true },
    }));
  return { lat: loc?.latitude ?? null, lng: loc?.longitude ?? null };
};

export const _attachItemRatings = async <T extends { id: string }>(
  items: T[],
): Promise<(T & { rating: number; reviewCount: number })[]> => {
  const ids = items.map((i) => i.id);
  const ratingByItem = new Map<string, { sum: number; count: number }>();

  if (ids.length) {
    const reviews = await prisma.review.findMany({
      where: { menuItemIds: { hasSome: ids } },
      select: { menuItemIds: true, foodRating: true },
    });
    for (const r of reviews) {
      for (const mid of r.menuItemIds) {
        if (!ratingByItem.has(mid)) ratingByItem.set(mid, { sum: 0, count: 0 });
        const agg = ratingByItem.get(mid)!;
        agg.sum += r.foodRating;
        agg.count += 1;
      }
    }
  }

  return items.map((item) => {
    const agg = ratingByItem.get(item.id);
    const count = agg?.count ?? 0;
    return {
      ...item,
      // The card shows the item's OWN food-review average (0.0 when it has no
      // reviews yet). It must not borrow the vendor's average — that made
      // unreviewed items all show the same number next to "0 reviews".
      rating: count > 0 ? parseFloat((agg!.sum / agg!.count).toFixed(1)) : 0,
      reviewCount: count,
    };
  });
};

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

  // Resolve the user's current delivery location so the delivery estimate
  // reflects how far THIS restaurant is from them.
  const { lat: userLat, lng: userLng } = await _resolveUserCoords(userId);

  const distanceKm =
    userLat !== null && userLng !== null && vendor.lat && vendor.lng
      ? haversineKm(userLat, userLng, vendor.lat, vendor.lng)
      : null;

  return {
    ...vendor,
    isFavorite,
    // Frontend reads `reviewCount`; the stored field is `totalReviews`. Alias it
    // so the count and "% positive" (positiveReviews / reviewCount) compute.
    reviewCount: vendor.totalReviews,
    distanceKm,
    distanceLabel: distanceKm !== null ? formatDistance(distanceKm) : null,
    deliveryTime:
      distanceKm !== null ? `${estimateEtaMinutes(distanceKm)} mins` : null,
  };
};

// ── Backend: getRestaurantMenu ────────────────────────────────────────────────

export const getRestaurantMenu = async (
  vendorId: string,
  query: PaginationQuery & { search?: string },
  userId?: string | null,
  categoryId?: string,
) => {
  const { page, limit, skip } = parsePagination(query);

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

  // ── Favorite item IDs for this user ──────────────────────────────────────
  const favoriteItemIds = new Set<string>();
  if (userId) {
    const favs = await prisma.favoriteProduct.findMany({
      where: { userId },
      select: { menuItemId: true },
    });
    favs.forEach((f: { menuItemId: string }) =>
      favoriteItemIds.add(f.menuItemId),
    );
  }

  const whereClause: any = {
    vendorId,
    isActive: true,
    ...(categoryId ? { categories: { some: { categoryId } } } : {}),
    ...(query.search
      ? { name: { contains: query.search, mode: "insensitive" } }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.menuItem.findMany({
      where: whereClause,
      include: {
        categories: {
          include: { category: { select: { id: true, name: true } } },
        },
        images: true,
        ingredients: true,
      },
      orderBy: [{ isBestSeller: "desc" }, { name: "asc" }],
      skip,
      take: limit,
    }),
    prisma.menuItem.count({ where: whereClause }),
  ]);

  // ── Per-item review aggregates ─────────────────────────────────────────────
  // Reviews reference the items they cover via the `menuItemIds` array. Build
  // a rating/count map for just the items on this page so each card shows its
  // own real rating and review count instead of a hardcoded 0 / the vendor avg.
  const ratingByItem = new Map<string, { sum: number; count: number }>();
  const pageItemIds = items.map((i: any) => i.id);
  if (pageItemIds.length) {
    const relevantReviews = await prisma.review.findMany({
      where: { menuItemIds: { hasSome: pageItemIds } },
      select: { menuItemIds: true, foodRating: true },
    });
    for (const r of relevantReviews) {
      for (const mid of r.menuItemIds) {
        if (!ratingByItem.has(mid)) ratingByItem.set(mid, { sum: 0, count: 0 });
        const agg = ratingByItem.get(mid)!;
        agg.sum += r.foodRating;
        agg.count += 1;
      }
    }
  }

  const mappedItems = items.map((item: any) => {
    const optionalIngredients = item.ingredients.filter(
      (ing: any) => ing.isOptional,
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
        options: ings.map(
          (ing: { id: string; name: string; price: number | null }) => ({
            id: ing.id,
            name: ing.name,
            extraPrice: ing.price ?? 0,
          }),
        ),
      }),
    );

    const agg = ratingByItem.get(item.id);
    const itemRating =
      agg && agg.count > 0 ? parseFloat((agg.sum / agg.count).toFixed(1)) : 0;
    const itemReviewCount = agg?.count ?? 0;

    return {
      id: item.id,
      name: item.name,
      description: item.description ?? null,
      price: item.price,
      isActive: item.isActive,
      isBestSeller: item.isBestSeller,
      isCustomizable: item.isCustomizable,
      images: item.images.map((img: any) => ({
        id: img.id,
        url: img.url,
        isMain: img.isMain,
      })),
      ingredients: item.ingredients.map((ing: any) => ({
        id: ing.id,
        name: ing.name,
        portion: ing.portion,
        mealType: ing.mealType,
        isOptional: ing.isOptional,
        price: ing.price ?? 0,
      })),
      // Real per-item aggregate — the item's own food-review average and
      // count. Shows 0.0 (0) until the item has reviews; it must not borrow
      // the vendor's average, which made every unreviewed item look rated.
      rating: itemReviewCount > 0 ? itemRating : 0,
      reviewCount: itemReviewCount,
      // ── Set.has() — consistent with all other services ──
      isFavorite: favoriteItemIds.has(item.id),
      vendor: {
        id: vendor.id,
        storeName: vendor.storeName,
        logoUrl: vendor.logoUrl ?? null,
        isOpen: vendor.isOpen,
        averageRating: vendor.averageRating,
      },
      categories: item.categories.map((c: any) => ({
        category: {
          id: c.category.id,
          name: c.category.name,
        },
      })),
      customGroups,
    };
  });

  return {
    items: mappedItems,
    meta: buildMeta(total, page, limit),
  };
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

  // getRestaurantReviews → restaurant feed shows the vendor-side tick reasons
  const shaped = reviews.map((r) => ({
    id: r.id,
    customerName: r.user.fullName,
    customerImage: r.user.imageUrl,
    rating: r.restaurantRating,
    date: r.createdAt.toISOString(),
    comment: r.comment ?? "",
    tags: pickReviewTags(r.tags, "vendor"),
    verified: r.isVerified,
    orderDate: r.order?.createdAt.toISOString() ?? null,
    proofUrls: pickReviewTags(r.proofUrls, "vendor"),
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
  // Match reviews linked to this item either through the denormalized
  // `menuItemIds` array (new reviews) or through the order's line items
  // (covers older reviews saved before items were linked).
  const where = {
    OR: [
      { menuItemIds: { has: menuItemId } },
      { order: { items: { some: { menuItemId } } } },
    ],
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

  // Shape identical to getRestaurantReviews so the same review-list UI renders
  // either source without per-field guards.
  // getProductReviews → product feed shows the food-side tick reasons
  const shaped = reviews.map((r) => ({
    id: r.id,
    customerName: r.user.fullName,
    customerImage: r.user.imageUrl,
    rating: r.foodRating,
    date: r.createdAt.toISOString(),
    comment: r.comment ?? "",
    tags: pickReviewTags(r.tags, "food"),
    verified: r.isVerified,
    orderDate: r.order?.createdAt.toISOString() ?? null,
    proofUrls: pickReviewTags(r.proofUrls, "food"),
  }));

  return { reviews: shaped, meta: buildMeta(total, page, limit) };
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

  if (userId && searchTerm.length >= 2) {
    prisma.searchHistory
      .create({ data: { userId, query: searchTerm } })
      .catch(() => {});
  }

  // ── Fetch favorite IDs upfront for both types ──────────────────────────────
  const favoriteVendorIds = new Set<string>();
  const favoriteItemIds = new Set<string>();

  if (userId) {
    const [vendorFavs, itemFavs] = await Promise.all([
      type === "restaurants" || type === "all"
        ? prisma.favoriteRestaurant.findMany({
            where: { userId },
            select: { vendorId: true },
          })
        : Promise.resolve([]),
      type === "foods" || type === "all"
        ? prisma.favoriteProduct.findMany({
            where: { userId },
            select: { menuItemId: true },
          })
        : Promise.resolve([]),
    ]);

    vendorFavs.forEach((f: { vendorId: string }) =>
      favoriteVendorIds.add(f.vendorId),
    );
    itemFavs.forEach((f: { menuItemId: string }) =>
      favoriteItemIds.add(f.menuItemId),
    );
  }

  const results: Record<string, unknown> = {};
  let totalRestaurants = 0;
  let totalFoods = 0;

  if (type === "restaurants" || type === "all") {
    const { lat: userLat, lng: userLng } = await _resolveUserCoords(userId);
    const vendorWhere = {
      storeName: { contains: searchTerm, mode: "insensitive" as const },
    };
    const [vendors, vendorTotal] = await Promise.all([
      prisma.vendorProfile.findMany({
        where: vendorWhere,
        skip,
        take: limit,
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
        },
      }),
      prisma.vendorProfile.count({ where: vendorWhere }),
    ]);
    totalRestaurants = vendorTotal;

    results.restaurants = vendors.map((v) => {
      const distanceKm =
        userLat !== null && userLng !== null && v.lat && v.lng
          ? haversineKm(userLat, userLng, v.lat, v.lng)
          : null;
      return {
        id: v.id,
        name: v.storeName,
        image: v.bannerUrl ?? null,
        logo: v.logoUrl ?? null,
        rating: v.averageRating,
        reviewCount: v.totalReviews,
        isOpen: v.isOpen,
        address: v.address ?? null,
        positiveReviews: v.positiveReviews,
        distanceKm,
        distanceLabel: distanceKm !== null ? formatDistance(distanceKm) : null,
        closesIn: null,
        isYourUsual: false,
        isFavorite: favoriteVendorIds.has(v.id),
        // Distance-derived delivery estimate (null when we can't place the user).
        deliveryTime:
          distanceKm !== null ? `${estimateEtaMinutes(distanceKm)} mins` : null,
      };
    });
  }

  if (type === "foods" || type === "all") {
    const foodWhere = {
      isActive: true,
      name: { contains: searchTerm, mode: "insensitive" as const },
    };
    const [foods, foodTotal] = await Promise.all([
      prisma.menuItem.findMany({
        where: foodWhere,
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
      }),
      prisma.menuItem.count({ where: foodWhere }),
    ]);
    totalFoods = foodTotal;

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
      isFavorite: favoriteItemIds.has(f.id),
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

  // For a single-type search, meta.total/totalPages reflects that type's
  // count so `hasNextPage` in the infinite-query frontend works correctly.
  // For "all" (not currently used by any screen, which always searches a
  // single tab) we sum both counts as a reasonable approximation.
  const total =
    type === "restaurants"
      ? totalRestaurants
      : type === "foods"
        ? totalFoods
        : totalRestaurants + totalFoods;

  return { ...results, meta: buildMeta(total, page, limit) };
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
    search?: string;
  },
  userId?: string | null,
) => {
  const { page, limit, skip } = parsePagination(query);

  // ── User's favorite item IDs ──
  const favoriteItemIds = new Set<string>();
  if (userId) {
    const favs = await prisma.favoriteProduct.findMany({
      where: { userId },
      select: { menuItemId: true },
    });
    favs.forEach((f: { menuItemId: string }) =>
      favoriteItemIds.add(f.menuItemId),
    );
  }

  const where = {
    isActive: true,
    categories: {
      some: {
        category: {
          name: { contains: categoryName, mode: "insensitive" as const },
        },
      },
    },
    ...(query.search
      ? { name: { contains: query.search, mode: "insensitive" as const } }
      : {}),
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
        images: { select: { id: true, url: true, isMain: true } },
      },
      orderBy: [{ isBestSeller: "desc" }, { name: "asc" }],
      skip,
      take: limit,
    }),
    prisma.menuItem.count({ where }),
  ]);

  return {
    items: items.map((item) => ({
      ...item,
      isFavorite: favoriteItemIds.has(item.id),
    })),
    meta: buildMeta(total, page, limit),
  };
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
    search?: string;
    sort?: string;
  },
  userId?: string | null,
) => {
  const { page, limit, skip } = parsePagination(query);
  const radiusKm = query.radiusKm
    ? parseFloat(query.radiusKm)
    : await cfg.catalog.vendorRadiusKm();

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

  // ── User's favorite vendors ────────────────────────────────────────────────
  const favoriteVendorIds = new Set<string>();
  if (userId) {
    const favs = await prisma.favoriteRestaurant.findMany({
      where: { userId },
      select: { vendorId: true },
    });
    favs.forEach((f: { vendorId: string }) =>
      favoriteVendorIds.add(f.vendorId),
    );
  }

  // ── Build filter where clause ──────────────────────────────────────────────
  const where: any = {
    ...(query.isOpen === "true" ? { isOpen: true } : {}),
    ...(query.minRating
      ? { averageRating: { gte: Number(query.minRating) } }
      : {}),
    ...(query.search
      ? { storeName: { contains: query.search, mode: "insensitive" } }
      : {}),
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

  // ── Sort ────────────────────────────────────────────────────────────────────
  // "closest"/"fastest" (fastest is proxied by distance — we don't track a
  // separate delivery-speed metric) sort purely by distance. "highest" sorts
  // purely by rating. Anything else (including the default "recommended" and
  // the unsupported "lowest-fee" — there's no delivery-fee field on the
  // vendor — falls back to the combined distance+rating heuristic below.
  const sorted = filtered.sort((a, b) => {
    if (query.sort === "closest" || query.sort === "fastest") {
      if (a.distanceKm === null && b.distanceKm === null) return 0;
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    }
    if (query.sort === "highest") {
      return b.averageRating - a.averageRating;
    }
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
      isFavorite: favoriteVendorIds.has(v.id),
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
          storeStatus: true,
          averageRating: true,
        },
      },
      images: true, // New relation for multiple images
      categories: { include: { category: true } },
      ingredients: true, // Now uses MenuItemIngredient model
      optionGroups: {
        include: {
          options: {
            include: { sizes: { orderBy: { sortOrder: "asc" } } },
            orderBy: { sortOrder: "asc" },
          },
        },
      },
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

// ─────────────────────────────────────────────────────────────────────────────
// Meal picks (time-of-day aware, lat/lng-resolved)
// ─────────────────────────────────────────────────────────────────────────────

const MEAL_WINDOWS: Record<string, { start: number; end: number }> = {
  breakfast: { start: 5, end: 10 }, // 5:00 – 10:59
  lunch: { start: 11, end: 15 }, // 11:00 – 15:59
  dinner: { start: 16, end: 22 }, // 16:00 – 22:59
  // 23:00–04:59 falls through to "dinner" — late-night cravings map to
  // dinner-type food, and most breakfast vendors are closed at that hour.
};

const resolveMealFromHour = (
  hour: number,
): "breakfast" | "lunch" | "dinner" => {
  if (
    hour >= MEAL_WINDOWS.breakfast.start &&
    hour <= MEAL_WINDOWS.breakfast.end
  )
    return "breakfast";
  if (hour >= MEAL_WINDOWS.lunch.start && hour <= MEAL_WINDOWS.lunch.end)
    return "lunch";
  return "dinner";
};

/**
 * Returns the current hour (0-23) at the given coordinates.
 *
 * Uses tz-lookup to map lat/lng → IANA timezone name, then Intl to read
 * the hour in that timezone. Falls back to Africa/Lagos when no coords
 * are provided or when tzlookup throws on invalid coords.
 *
 * tz-lookup is offline (bundled polygon data), so no upstream call latency.
 */
const currentHourForCoords = (
  lat: number | null,
  lng: number | null,
): number => {
  let tz = "Africa/Lagos";
  if (lat !== null && lng !== null) {
    try {
      tz = tzlookup(lat, lng);
    } catch {
      // Invalid coords. Stick with Lagos fallback rather than 500 the request.
    }
  }

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  });
  return parseInt(fmt.format(new Date()), 10);
};

export const getMealPicks = async (
  opts: {
    userId?: string;
    radiusKm?: string;
    meal?: "breakfast" | "lunch" | "dinner";
  } = {},
) => {
  const radiusKm = opts.radiusKm
    ? parseFloat(opts.radiusKm)
    : await cfg.catalog.vendorRadiusKm();

  // Resolve the user's saved location first — used for both the meal-time
  // timezone decision and the radius filter further below.
  let userLat: number | null = null;
  let userLng: number | null = null;
  if (opts.userId) {
    const loc = await prisma.savedLocation.findFirst({
      where: { userId: opts.userId, isDefault: true },
    });
    userLat = loc?.latitude ?? null;
    userLng = loc?.longitude ?? null;
  }

  // Server time isn't trustworthy (Render runs UTC; users in Lagos are UTC+1
  // and could see "dinner picks" at 5 AM local). Resolve the hour at the
  // user's actual location instead.
  const meal =
    opts.meal ?? resolveMealFromHour(currentHourForCoords(userLat, userLng));

  // Meal-specific match — no fallback to "popular" items. If no vendor has
  // tagged a category matching this meal, the section comes back empty and
  // the home screen shows an empty state. Chosen over a fallback that could
  // surface breakfast items under "Dinner picks" or vice versa.
  const items = await prisma.menuItem.findMany({
    where: {
      isActive: true,
      vendor: { isOpen: true },
      categories: {
        some: {
          category: {
            name: { contains: meal, mode: "insensitive" as const },
          },
        },
      },
    },
    include: {
      vendor: true,
      images: { where: { isMain: true }, take: 1 },
      ...(opts.userId ? { favorites: { where: { userId: opts.userId } } } : {}),
      _count: { select: { orderItems: true } },
    },
    orderBy: { isBestSeller: "desc" },
    take: 40,
  });

  // Radius filter — applied only when we know where the user is. Vendors
  // missing coordinates pass through (safer than hiding them).
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

  return {
    meal,
    items: filtered.slice(0, 15).map((item: any) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      images: item.images,
      isBestSeller: item.isBestSeller,
      isFavorite: item.favorites ? item.favorites.length > 0 : false,
      vendor: {
        id: item.vendor.id,
        storeName: item.vendor.storeName,
        averageRating: item.vendor.averageRating,
      },
    })),
  };
};

// updated getAllVendors and getAllMenuItems

export const getAllVendors = async (
  query: PaginationQuery & { search?: string; filter?: string },
  userId?: string | null,
) => {
  const { page, limit, skip } = parsePagination(query);

  // Identify user's usual vendors (completed orders)
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

  // For favorites filter — fetch vendorIds the user has favorited
  let favoriteVendorIds: string[] | null = null;
  if (userId && query.filter === "favorites") {
    const favs = await prisma.favoriteRestaurant.findMany({
      where: { userId },
      select: { vendorId: true },
    });
    favoriteVendorIds = favs.map((f: { vendorId: string }) => f.vendorId);
  }

  const where: any = {
    setupProgress: 100,
    ...(query.search
      ? { storeName: { contains: query.search, mode: "insensitive" } }
      : {}),
    ...(query.filter === "open" ? { isOpen: true } : {}),
    ...(query.filter === "usuals" && usualVendorIds.size > 0
      ? { id: { in: [...usualVendorIds] } }
      : {}),
    ...(favoriteVendorIds !== null ? { id: { in: favoriteVendorIds } } : {}),
  };

  const orderBy =
    query.filter === "top_rated"
      ? { averageRating: "desc" as const }
      : { averageRating: "desc" as const };

  // Fetch favorited vendor IDs for isFavorite flag on each card
  let userFavoriteVendorIds = new Set<string>();
  if (userId) {
    const favs = await prisma.favoriteRestaurant.findMany({
      where: { userId },
      select: { vendorId: true },
    });
    favs.forEach((f: { vendorId: string }) =>
      userFavoriteVendorIds.add(f.vendorId),
    );
  }

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
      orderBy,
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
        isFavorite: userFavoriteVendorIds.has(v.id),
      })),
    },
    meta: buildMeta(total, page, limit),
  };
};

export const getAllMenuItems = async (
  query: PaginationQuery & { search?: string; filter?: string },
  userId?: string | null,
) => {
  const { page, limit, skip } = parsePagination(query);

  // For favorites filter — fetch menuItemIds the user has favorited
  let favoriteItemIds: string[] | null = null;
  if (userId && query.filter === "favorites") {
    const favs = await prisma.favoriteProduct.findMany({
      where: { userId },
      select: { menuItemId: true },
    });
    favoriteItemIds = favs.map((f: { menuItemId: string }) => f.menuItemId);
  }

  const where: any = {
    vendor: { setupProgress: 100 },
    ...(query.search
      ? { name: { contains: query.search, mode: "insensitive" } }
      : {}),
    ...(query.filter === "best_sellers" ? { isBestSeller: true } : {}),
    ...(favoriteItemIds !== null ? { id: { in: favoriteItemIds } } : {}),
  };

  // Fetch all favorited item IDs for the isFavorite flag on each card
  let userFavoriteItemIds = new Set<string>();
  if (userId) {
    const favs = await prisma.favoriteProduct.findMany({
      where: { userId },
      select: { menuItemId: true },
    });
    favs.forEach((f: { menuItemId: string }) =>
      userFavoriteItemIds.add(f.menuItemId),
    );
  }

  const [items, total] = await Promise.all([
    prisma.menuItem.findMany({
      where,
      include: {
        vendor: {
          select: {
            id: true,
            storeName: true,
            averageRating: true,
            // Remove deliveryFee and deliveryTime — not in your VendorProfile schema
          },
        },
        images: { where: { isMain: true }, take: 1 },
      },
      orderBy: { isBestSeller: "desc" },
      skip,
      take: limit,
    }) as any, // cast to any so TypeScript stops fighting the include shape
    prisma.menuItem.count({ where }),
  ]);

  return {
    data: {
      items: items.map((item: any) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        images: item.images || null,
        isBestSeller: item.isBestSeller,
        isFavorite: userFavoriteItemIds.has(item.id),
        vendor: {
          id: item.vendor.id,
          storeName: item.vendor.storeName,
          averageRating: item.vendor.averageRating,
          // Only include fields that exist on VendorProfile
        },
      })),
    },
    meta: buildMeta(total, page, limit),
  };
};
