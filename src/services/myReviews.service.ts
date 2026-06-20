// src/services/myReviews.service.ts
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { parsePagination, buildMeta, pickReviewTags } from "../utils";
import { PaginationQuery } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Pending reviews — delivered orders with no review yet
// ─────────────────────────────────────────────────────────────────────────────

export const getPendingReviews = async (
  userId: string,
  query: PaginationQuery,
) => {
  const { page, limit, skip } = parsePagination(query);

  const where: any = {
    userId,
    // Loosened to include orders that have been physically delivered (rider
    // dropped off) — review eligibility shouldn't wait on the customer OTP step.
    // See "Fix 2" below for what counts as "delivered".
    OR: [
      { status: "completed" as const },
      { delivery: { is: { status: "delivered" } } },
    ],
    // Use the explicit `is: null` form — safer than `review: null` across
    // Prisma versions, which has had bugs on 1:1 optional back-relations.
    review: { is: null },
  };

  const [deliveredOrders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        items: {
          take: 1,
          include: {
            menuItem: { select: { name: true, images: true, price: true } },
          },
        },
        vendor: { select: { storeName: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  const data = deliveredOrders.map((order) => {
    const firstItem = order.items[0];
    return {
      id: order.id,
      orderId: order.orderId,
      name: firstItem?.menuItem.name ?? "Order",
      price: order.totalAmount,
      images: firstItem?.menuItem.images ?? null,
      vendor: order.vendor.storeName,
      qty: order.items.reduce((s, i) => s + i.qty, 0),
    };
  });

  return {
    data,
    meta: buildMeta(total, page, limit),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Past reviews — orders the user has already reviewed
// ─────────────────────────────────────────────────────────────────────────────

export const getPastReviews = async (
  userId: string,
  query: PaginationQuery,
) => {
  const { page, limit, skip } = parsePagination(query);

  const where: any = { userId };

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where,
      include: {
        order: {
          include: {
            items: {
              take: 1,
              include: {
                menuItem: { select: { name: true, images: true, price: true } },
              },
            },
            vendor: { select: { storeName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.review.count({ where }),
  ]);

  const data = reviews.map((r) => {
    const firstItem = r.order.items[0];
    return {
      id: r.id,
      orderId: r.orderId,
      name: firstItem?.menuItem.name ?? "Order",
      price: r.order.totalAmount,
      images: firstItem?.menuItem.images ?? null,
      vendor: r.order.vendor.storeName,
      qty: r.order.items.reduce((s, i) => s + i.qty, 0),
      restaurantRating: r.restaurantRating,
      foodRating: r.foodRating,
      riderRating: r.riderRating,
      tags: pickReviewTags(r.tags, "vendor", "food", "rider"),
      comment: r.comment,
      createdAt: r.createdAt,
    };
  });

  return {
    data,
    meta: buildMeta(total, page, limit),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Review detail
// ─────────────────────────────────────────────────────────────────────────────

export const getReviewDetail = async (userId: string, reviewId: string) => {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    include: {
      order: {
        include: {
          items: {
            include: {
              menuItem: { select: { name: true, images: true, price: true } },
            },
          },
          vendor: { select: { storeName: true, logoUrl: true } },
        },
      },
    },
  });
  if (!review) throw AppError.notFound("Review");

  const firstItem = review.order.items[0];
  const images = firstItem?.menuItem.images ?? [];
  const mainImage =
    images.find((img: any) => img.isMain)?.url ?? images[0]?.url ?? null;

  // Flat, frontend-ready shape (mirrors PastReview + the fields the detail
  // screen reads: image, name, qty, price, orderId, ratings, comment, tags).
  return {
    id: review.id,
    orderId: review.order.orderId,
    name: firstItem?.menuItem.name ?? "Order",
    image: mainImage,
    vendor: review.order.vendor.storeName,
    qty: review.order.items.reduce((s, i) => s + i.qty, 0),
    price: review.order.totalAmount,
    restaurantRating: review.restaurantRating,
    foodRating: review.foodRating,
    riderRating: review.riderRating,
    tags: pickReviewTags(review.tags, "vendor", "food", "rider"),
    comment: review.comment,
    createdAt: review.createdAt,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Update review
// ─────────────────────────────────────────────────────────────────────────────

export const updateReview = async (
  userId: string,
  reviewId: string,
  data: {
    restaurantRating?: number;
    foodRating?: number;
    riderRating?: number;
    tags?: string[];
    comment?: string;
  },
) => {
  const existing = await prisma.review.findFirst({
    where: { id: reviewId, userId },
  });
  if (!existing) throw AppError.notFound("Review");

  return prisma.review.update({ where: { id: reviewId }, data });
};

// ─────────────────────────────────────────────────────────────────────────────
// Delete review
// ─────────────────────────────────────────────────────────────────────────────

export const deleteReview = async (
  userId: string,
  reviewId: string,
): Promise<void> => {
  const existing = await prisma.review.findFirst({
    where: { id: reviewId, userId },
  });
  if (!existing) throw AppError.notFound("Review");
  await prisma.review.delete({ where: { id: reviewId } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Get review order data (for filling the review form)
// ─────────────────────────────────────────────────────────────────────────────

export const getReviewOrderData = async (userId: string, orderId: string) => {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      userId,
      OR: [
        { status: "completed" as const },
        { delivery: { is: { status: "delivered" } } },
      ],
    },
    include: {
      items: {
        include: {
          menuItem: { select: { name: true, images: true, price: true } },
        },
      },
      vendor: { select: { storeName: true, logoUrl: true } },
      review: true,
    },
  });
  if (!order) throw AppError.notFound("Order");

  return {
    id: order.id,
    orderId: order.orderId,
    restaurantName: order.vendor.storeName,
    items: order.items.map((i) => ({
      name: i.menuItem.name,
      qty: i.qty,
      price: i.price,
      image: i.menuItem.images,
    })),
    totalAmount: order.totalAmount,
    existingReview: order.review
      ? {
          restaurantRating: order.review.restaurantRating,
          foodRating: order.review.foodRating,
          riderRating: order.review.riderRating,
          tags: pickReviewTags(order.review.tags, "vendor", "food", "rider"),
          comment: order.review.comment,
        }
      : null,
  };
};
