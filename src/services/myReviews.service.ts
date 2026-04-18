// src/services/myReviews.service.ts
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";

// ─────────────────────────────────────────────────────────────────────────────
// Pending reviews — delivered orders with no review yet
// ─────────────────────────────────────────────────────────────────────────────

export const getPendingReviews = async (userId: string) => {
  const deliveredOrders = await prisma.order.findMany({
    where: {
      userId,
      status: "completed",
      review: null, // no review submitted yet
    },
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
    take: 20,
  });

  return deliveredOrders.map((order) => {
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
};

// ─────────────────────────────────────────────────────────────────────────────
// Past reviews — orders the user has already reviewed
// ─────────────────────────────────────────────────────────────────────────────

export const getPastReviews = async (userId: string) => {
  const reviews = await prisma.review.findMany({
    where: { userId },
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
  });

  return reviews.map((r) => {
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
      tags: r.tags,
      comment: r.comment,
      createdAt: r.createdAt,
    };
  });
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
  return review;
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
    where: { id: orderId, userId, status: "completed" },
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
          tags: order.review.tags,
          comment: order.review.comment,
        }
      : null,
  };
};
