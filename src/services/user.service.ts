// src/services/user.service.ts
import bcrypt from "bcryptjs";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { buildMeta, parsePagination } from "../utils";
import { CheckoutInput, PaginationQuery } from "../types";
import { UserNotificationSettingsPayload } from "../types/notifications";
import { cfg } from "./config.service";
import * as notif from "../events/notification.events";
import * as paymentService from "../services/payment.service";

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

export const getProfile = async (userId: string) => {
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
      location: true,
      profileCompletion: true,
      referralCode: true,
      role: true,
    },
  });
  if (!user) throw AppError.notFound("User");
  return user;
};

export const updateProfile = async (
  userId: string,
  data: {
    fullName?: string;
    phone?: string;
    imageUrl?: string;
    location?: string;
  },
) => {
  return prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      fullName: true,
      phone: true,
      imageUrl: true,
      location: true,
    },
  });
};

export const changePassword = async (
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

export const deleteAccount = async (userId: string): Promise<void> => {
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false, email: `deleted_${userId}@rave.com` },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Saved Locations
// ─────────────────────────────────────────────────────────────────────────────

export const getSavedLocations = (userId: string) =>
  prisma.savedLocation.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

export const upsertLocation = (
  userId: string,
  data: {
    name: string;
    description: string;
    latitude: number;
    longitude: number;
    type: string;
    instructions?: string;
    isDefault?: boolean;
  },
  locationId?: string,
) => {
  if (locationId) {
    return prisma.savedLocation.update({ where: { id: locationId }, data });
  }

  return prisma.savedLocation.create({ data: { userId, ...data } });
};

export const deleteLocation = async (
  userId: string,
  locationId: string,
): Promise<void> => {
  const loc = await prisma.savedLocation.findFirst({
    where: { id: locationId, userId },
  });
  if (!loc) throw AppError.notFound("Location");
  await prisma.savedLocation.delete({ where: { id: locationId } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Transactions
// ─────────────────────────────────────────────────────────────────────────────

export const getTransactions = async (
  userId: string,
  query: PaginationQuery & { type?: string },
) => {
  const { page, limit, skip } = parsePagination(query);

  const validTypes = [
    "top_up",
    "order_payment",
    "refund",
    "referral_bonus",
    "withdrawal",
    "payout",
  ];
  const typeFilter =
    query.type && query.type !== "all" && validTypes.includes(query.type)
      ? (query.type as any)
      : undefined;

  const where = {
    userId,
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
  return { transactions, meta: buildMeta(total, page, limit) };
};

export const getTransactionById = async (userId: string, txId: string) => {
  const tx = await prisma.transaction.findFirst({
    where: { id: txId, userId },
    include: { order: true },
  });
  if (!tx) throw AppError.notFound("Transaction");
  return tx;
};

// ─────────────────────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────────────────────

export const getOrders = async (
  userId: string,
  query: PaginationQuery & { status?: string },
) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    userId,
    ...(query.status && query.status !== "all"
      ? { status: query.status as any }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        items: true,
        vendor: { select: { storeName: true, logoUrl: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);
  return { orders, meta: buildMeta(total, page, limit) };
};

export const getOrderById = async (userId: string, orderId: string) => {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: {
      menuItem: {
        include: {
          images: true,
        },
      },
      user: { select: { fullName: true, phone: true, imageUrl: true } },
      vendor: {
        select: {
          storeName: true,
          logoUrl: true,
          address: true,
          lat: true,
          lng: true,
        },
      },
      review: true,
      delivery: {
        include: {
          rider: {
            select: {
              currentLat: true,
              currentLng: true,
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
    deliveryInstructions: order.deliveryInstructions,
    contactMethod: order.contactMethod ?? "in-app",
    rider: rider
      ? {
          name: rider.user?.fullName ?? "",
          phone: rider.user?.phone ?? "",
          image: rider.user.imageUrl,
          lat: rider.currentLat,
          lng: rider.currentLng,
        }
      : null,
    restaurant: {
      name: order.vendor.storeName,
      image: order.vendor.logoUrl,
      address: order.vendor.address ?? null,
      lat: order.vendor.lat ?? null,
      lng: order.vendor.lng ?? null,
    },
  };
};

export const applyPromoCode = async (
  userId: string,
  code: string,
  subtotal: number,
  vendorId: string,
): Promise<{
  valid: boolean;
  discountAmount: number;
  message: string;
  promotionId?: string;
}> => {
  const promo = await prisma.promotion.findFirst({
    where: {
      promoCode: code.trim().toUpperCase(),
      vendorId,
      isActive: true,
      startDate: { lte: new Date() },
      endDate: { gte: new Date() },
    },
  });

  if (!promo)
    return {
      valid: false,
      discountAmount: 0,
      message: "Invalid or expired promo code.",
    };
  if (promo.maxUses && promo.timesUsed >= promo.maxUses)
    return {
      valid: false,
      discountAmount: 0,
      message: "This promo code has reached its usage limit.",
    };
  if (promo.minimumOrder && subtotal < promo.minimumOrder)
    return {
      valid: false,
      discountAmount: 0,
      message: `Minimum order of ₦${promo.minimumOrder.toLocaleString()} required.`,
    };

  let discountAmount = 0;
  if (promo.type === "percentage_discount" && promo.discountValue)
    discountAmount = Math.round(subtotal * (promo.discountValue / 100));
  else if (promo.type === "fixed_discount" && promo.discountValue)
    discountAmount = Math.min(promo.discountValue, subtotal);
  else if (promo.type === "free_delivery")
    discountAmount = await cfg.fees.deliveryBase();

  return {
    valid: true,
    discountAmount,
    promotionId: promo.id,
    message: `${promo.title} applied! You save ₦${discountAmount.toLocaleString()}.`,
  };
};

export const processCheckout = async (
  userId: string,
  dto: CheckoutInput,
): Promise<{
  orderId: string;
  paymentUrl?: string;
  reference: string;
}> => {
  // 1. Fetch Dynamic Cart (Pricing, VAT, and automatic promos)
  const { items, summary } = await getCart(userId);

  if (!items.length || !summary) {
    throw AppError.badRequest("Your cart is empty.");
  }

  // 2. Fetch the source SavedLocation
  const loc = await prisma.savedLocation.findFirst({
    where: { id: dto.savedLocationId, userId },
  });
  if (!loc) throw AppError.notFound("Saved location");

  // Fetch user email for Paystack
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) throw AppError.notFound("User not found");

  const vendorId = items[0].menuItem.vendorId;

  // 3. Database Transaction: Create the Order
  const order = await prisma.$transaction(async (tx) => {
    // Standard ETA logic
    const etaMinutes = 25;
    const arrivalTime = new Date();
    arrivalTime.setMinutes(arrivalTime.getMinutes() + etaMinutes);

    return await tx.order.create({
      data: {
        userId,
        vendorId,
        totalAmount: summary.total,
        deliveryFee: summary.deliveryBase || 0,
        vat: summary.vat || 0,
        serviceFee: summary.serviceFee || 0,
        discountAmount: summary.discountAmount || 0,
        paymentMethod: dto.paymentMethod,
        status: "new", // Initial state

        estimatedArrival: arrivalTime,
        etaDuration: etaMinutes,
        evidenceUrl: "",

        // Mapping SavedLocation fields to Order columns
        deliveryAddress: loc.description,
        deliveryLat: loc.latitude,
        deliveryLng: loc.longitude,
        deliveryInstructions: dto.instructions ?? loc.instructions,
        contactMethod: dto.contactMethod ?? "in-app",

        items: {
          create: items.map((item) => ({
            menuItemId: item.menuItem.id,
            name: item.menuItem.name,
            qty: item.qty,
            price: item.currentPrice,
          })),
        },
      },
    });
  });

  // 4. Initialize Payment (Initiated Phase)
  // This creates the 'initiated' transaction record in your DB and gets the Paystack URL
  const payment = await paymentService.initializeCheckout(
    user.email,
    summary.total,
    dto.paymentMethod as "card" | "bank_transfer",
    "order",
    vendorId,
    userId,
    order.id,
  );

  // 5. Cleanup: Clear the cart
  await prisma.cartItem.deleteMany({ where: { userId } });

  // 6. Notifications (Non-blocking)
  const itemsSummary = items
    .map((i) => `${i.qty}x ${i.menuItem.name}`)
    .join(", ");
  notif.notifyOrderPlaced(userId, order.orderId, itemsSummary, summary.total);

  return {
    orderId: order.orderId,
    paymentUrl: payment.authorizationUrl,
    reference: payment.reference as string,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Cart
// ─────────────────────────────────────────────────────────────────────────────

export const getCart = async (userId: string) => {
  // 1. Fetch Cart Items with MenuItem and associated Images
  const cartItems = await prisma.cartItem.findMany({
    where: { userId },
    include: {
      menuItem: {
        include: {
          images: {
            orderBy: { isMain: "desc" }, // Ensures main image is first
          },
        },
      },
    },
  });

  if (cartItems.length === 0) return { items: [], summary: null };

  // 2. Fetch Active Promotions for the Vendor
  // (Assuming single-vendor cart restriction is enforced)
  const vendorId = cartItems[0].menuItem.vendorId;
  const now = new Date();

  const activePromos = await prisma.promotion.findMany({
    where: {
      vendorId,
      isActive: true,
      startDate: { lte: now },
      endDate: { gte: now },
      promoCode: null, // Automatically applied (no code needed)
    },
  });

  let runningSubtotal = 0;
  let runningDiscountTotal = 0;

  // 3. Map items and calculate per-item discounts
  const mappedItems = cartItems.map((item) => {
    const originalPrice = item.menuItem.price;
    const itemSubtotal = originalPrice * item.qty;

    // Check if this specific product has an active promotion
    const promo = activePromos.find(
      (p) => p.appliesTo === "all" || p.productIds.includes(item.menuItemId),
    );

    let currentPrice = originalPrice;
    let discountLabel = null;

    if (promo && promo.discountValue) {
      if (promo.type === "percentage_discount") {
        discountLabel = `${promo.discountValue}% off`;
        currentPrice = originalPrice * (1 - promo.discountValue / 100);
      } else if (promo.type === "fixed_discount") {
        discountLabel = `₦${promo.discountValue} off`;
        currentPrice = Math.max(0, originalPrice - promo.discountValue);
      }
    }

    const itemFinalPrice = currentPrice * item.qty;
    runningSubtotal += itemSubtotal;
    runningDiscountTotal += itemSubtotal - itemFinalPrice;

    return {
      id: item.id,
      qty: item.qty,
      extras: item.extras, // From your Json field
      discountLabel,
      originalPrice,
      currentPrice,
      menuItem: {
        id: item.menuItem.id,
        name: item.menuItem.name,
        price: item.menuItem.price,
        vendorId: item.menuItem.vendorId,
        images: item.menuItem.images.map((img) => ({
          url: img.url,
          main: img.isMain,
        })),
      },
    };
  });

  const {
    vatRate: getVatRate,
    serviceFee: getServiceFee,
    deliveryBase: getDeliveryBase,
  } = cfg.fees;

  const vatRate = await getVatRate();
  const serviceFee = await getServiceFee();
  const deliveryBase = await getDeliveryBase();
  const baseTotal = runningSubtotal - runningDiscountTotal;
  const vatAmount = baseTotal * vatRate;
  const finalTotal = baseTotal + vatAmount + serviceFee;

  return {
    items: mappedItems,
    summary: {
      subtotal: runningSubtotal,
      discountAmount: runningDiscountTotal,
      vat: vatAmount,
      total: finalTotal, // This is the new total the frontend footer will display
      itemCount: mappedItems.length,
      serviceFee: serviceFee,
      deliveryBase: deliveryBase,
    },
  };
};

export const addToCart = async (
  userId: string,
  menuItemId: string,
  qty: number,
): Promise<void> => {
  const item = await prisma.menuItem.findUnique({ where: { id: menuItemId } });
  if (!item || !item.isActive) throw AppError.notFound("Menu item");

  // Check cart doesn't already have items from a different vendor
  const existing = await prisma.cartItem.findFirst({
    where: { userId },
    include: { menuItem: { select: { vendorId: true } } },
  });
  if (existing && existing.menuItem.vendorId !== item.vendorId) {
    throw AppError.badRequest(
      "Your cart has items from another restaurant. Clear it first to add from this one.",
    );
  }

  await prisma.cartItem.upsert({
    where: { userId_menuItemId: { userId, menuItemId } },
    create: { userId, menuItemId, qty },
    update: { qty: { increment: qty } },
  });
};

export const updateCartItem = async (
  userId: string,
  menuItemId: string,
  qty: number,
): Promise<void> => {
  if (qty <= 0) {
    await prisma.cartItem.deleteMany({ where: { userId, menuItemId } });
    return;
  }
  await prisma.cartItem.upsert({
    where: { userId_menuItemId: { userId, menuItemId } },
    create: { userId, menuItemId, qty },
    update: { qty },
  });
};

export const removeFromCart = (userId: string, menuItemId: string) =>
  prisma.cartItem.deleteMany({ where: { userId, menuItemId } });

export const clearCart = (userId: string) =>
  prisma.cartItem.deleteMany({ where: { userId } });

// ─────────────────────────────────────────────────────────────────────────────
// Reviews
// ─────────────────────────────────────────────────────────────────────────────

export const submitReview = async (
  userId: string,
  data: {
    orderId: string;
    restaurantRating: number;
    foodRating: number;
    riderRating: number;
    tags?: string[];
    comment?: string;
    proofUrls?: string[];
    menuItemIds?: string[];
    resolutionPreference?: string;
  },
): Promise<void> => {
  const order = await prisma.order.findFirst({
    where: { id: data.orderId, userId, status: "completed" },
  });
  if (!order)
    throw AppError.badRequest("You can only review a completed order.");

  const existing = await prisma.review.findUnique({
    where: { orderId: data.orderId },
  });
  if (existing)
    throw AppError.conflict("You have already reviewed this order.");

  await prisma.review.create({
    data: {
      userId,
      vendorId: order.vendorId,
      orderId: data.orderId,
      restaurantRating: data.restaurantRating,
      foodRating: data.foodRating,
      riderRating: data.riderRating,
      tags: data.tags ?? [],
      comment: data.comment,
      proofUrls: data.proofUrls ?? [],
      images: data.proofUrls ?? [],
      menuItemIds: data.menuItemIds ?? [],
      resolutionPreference: data.resolutionPreference,
    },
  });

  // Update vendor's aggregate rating
  const stats = await prisma.review.aggregate({
    where: { vendorId: order.vendorId },
    _avg: { restaurantRating: true },
    _count: { id: true },
  });

  const newAvg = parseFloat((stats._avg.restaurantRating ?? 0).toFixed(1));
  const totalReviews = stats._count.id;
  const positiveReviews = await prisma.review.count({
    where: { vendorId: order.vendorId, restaurantRating: { gte: 4 } },
  });

  await prisma.vendorProfile.update({
    where: { id: order.vendorId },
    data: { averageRating: newAvg, totalReviews, positiveReviews },
  });

  // Notify vendor
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: order.vendorId },
    select: { userId: true },
  });
  if (vendor) {
    await notif.notifyVendorReviewReceived(
      vendor.userId,
      data.restaurantRating,
      data.comment,
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Refunds
// ─────────────────────────────────────────────────────────────────────────────

export const getRefunds = async (
  userId: string,
  query: PaginationQuery & { status?: string },
) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    userId,
    ...(query.status && query.status !== "all"
      ? { status: query.status as any }
      : {}),
  };

  const [refunds, total] = await Promise.all([
    prisma.refundRequest.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.refundRequest.count({ where }),
  ]);
  return { refunds, meta: buildMeta(total, page, limit) };
};

export const getRefundById = async (userId: string, refundId: string) => {
  const refund = await prisma.refundRequest.findFirst({
    where: { id: refundId, userId },
    include: { items: true },
  });
  if (!refund) throw AppError.notFound("Refund request");
  return refund;
};

export const requestRefund = async (
  userId: string,
  data: {
    orderId: string;
    issue: string;
    description: string;
    amountRequested: number;
    items: { name: string; qty: number }[];
  },
) => {
  const order = await prisma.order.findFirst({
    where: { id: data.orderId, userId },
  });
  if (!order) throw AppError.notFound("Order");

  return prisma.refundRequest.create({
    data: {
      userId,
      orderId: data.orderId,
      issue: data.issue,
      description: data.description,
      amountRequested: data.amountRequested,
      items: { create: data.items },
    },
    include: { items: true },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Referrals
// ─────────────────────────────────────────────────────────────────────────────

export const getReferralStats = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (!user) throw AppError.notFound("User");

  const [referrals, totalEarned] = await Promise.all([
    prisma.referral.findMany({
      where: { referrerId: userId },
      include: { referee: { select: { fullName: true, imageUrl: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.transaction.aggregate({
      where: { userId, type: "referral", status: "completed" },
      _sum: { amount: true },
    }),
  ]);

  return {
    referralCode: user.referralCode,
    totalReferrals: referrals.length,
    amountEarned: totalEarned._sum?.amount ?? 0,
    pendingReferrals: referrals.filter((r) => r.status === "pending").length,
    referrals,
  };
};

export const applyReferralCode = async (
  userId: string,
  code: string,
): Promise<void> => {
  const existing = await prisma.referral.findUnique({
    where: { refereeId: userId },
  });
  if (existing)
    throw AppError.conflict("You have already used a referral code.");

  const referrer = await prisma.user.findFirst({
    where: { referralCode: code },
  });
  if (!referrer) throw AppError.badRequest("Invalid referral code.");
  if (referrer.id === userId)
    throw AppError.badRequest("You cannot use your own referral code.");

  await prisma.referral.create({
    data: { referrerId: referrer.id, refereeId: userId },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────

export const getNotifications = async (
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

export const markAllNotificationsRead = (userId: string) =>
  prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });

export const deleteNotification = async (
  userId: string,
  notifId: string,
): Promise<void> => {
  await prisma.notification.deleteMany({ where: { id: notifId, userId } });
};

export const getNotificationSettings = async (userId: string) => {
  let settings = await prisma.notificationSettings.findUnique({
    where: { userId },
  });
  if (!settings) {
    settings = await prisma.notificationSettings.create({ data: { userId } });
  }
  return settings;
};

export const updateNotificationSettings = async (
  userId: string,
  data: UserNotificationSettingsPayload,
) => {
  return prisma.notificationSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Favorites
// ─────────────────────────────────────────────────────────────────────────────

export const toggleFavoriteRestaurant = async (
  userId: string,
  vendorId: string,
): Promise<{ isFavorite: boolean }> => {
  const existing = await prisma.favoriteRestaurant.findUnique({
    where: { userId_vendorId: { userId, vendorId } },
  });

  if (existing) {
    await prisma.favoriteRestaurant.delete({
      where: { userId_vendorId: { userId, vendorId } },
    });
    return { isFavorite: false };
  }

  await prisma.favoriteRestaurant.create({ data: { userId, vendorId } });
  return { isFavorite: true };
};

export const toggleFavoriteProduct = async (
  userId: string,
  menuItemId: string,
  vendorId: string,
): Promise<{ isFavorite: boolean }> => {
  const existing = await prisma.favoriteProduct.findUnique({
    where: { userId_menuItemId: { userId, menuItemId } },
  });

  if (existing) {
    await prisma.favoriteProduct.delete({
      where: { userId_menuItemId: { userId, menuItemId } },
    });
    return { isFavorite: false };
  }

  await prisma.favoriteProduct.create({
    data: { userId, menuItemId, vendorId },
  });
  return { isFavorite: true };
};
// ─────────────────────────────────────────────────────────────────────────────
// Refund — delete / cancel
// ─────────────────────────────────────────────────────────────────────────────

export const deleteRefundRequest = async (
  userId: string,
  refundId: string,
): Promise<void> => {
  const refund = await prisma.refundRequest.findFirst({
    where: { id: refundId, userId, status: "IN_REVIEW" },
  });
  if (!refund)
    throw AppError.notFound("Refund request or it is no longer cancellable.");
  await prisma.refundRequest.delete({ where: { id: refundId } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Search history
// ─────────────────────────────────────────────────────────────────────────────

export const getSearchSuggestions = async (userId: string) => {
  const [recent, popular] = await Promise.all([
    prisma.searchHistory.findMany({
      where: { userId },
      select: { query: true },
      orderBy: { createdAt: "desc" },
      take: 10,
      distinct: ["query"],
    }),
    prisma.searchHistory.groupBy({
      by: ["query"],
      _count: { query: true },
      orderBy: { _count: { query: "desc" } },
      take: 10,
    }),
  ]);
  return {
    recent: recent.map((r) => r.query),
    popular: popular.map((p) => p.query),
  };
};

export const clearSearchHistory = async (userId: string): Promise<void> => {
  await prisma.searchHistory.deleteMany({ where: { userId } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Home — usual orders (recently completed for quick reorder)
// ─────────────────────────────────────────────────────────────────────────────

export const getUsualOrders = async (userId: string) => {
  const orders = await prisma.order.findMany({
    where: { userId, status: "completed" },
    include: {
      items: { select: { name: true, qty: true, price: true } },
      vendor: { select: { id: true, storeName: true, logoUrl: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return orders.map((o) => ({
    id: o.id,
    orderId: o.orderId,
    vendor: o.vendor,
    totalAmount: o.totalAmount,
    items: o.items,
    createdAt: o.createdAt,
  }));
};

// ─────────────────────────────────────────────────────────────────────────────
// Favorites — GET lists
// ─────────────────────────────────────────────────────────────────────────────

export const getFavoriteRestaurants = async (userId: string) => {
  const deliveryBase = await cfg.fees.deliveryBase();

  const favorites = await prisma.favoriteRestaurant.findMany({
    where: { userId },
    include: {
      vendor: true, // This will now work because 'vendor' is defined in schema
    },
    orderBy: { id: "desc" },
  });

  // Map only if vendor exists (prevents crashes if a vendor was deleted)
  return favorites
    .filter((f) => f.vendor)
    .map((f) => {
      const v = f.vendor;
      return {
        id: v.id,
        name: v.storeName,
        image: v.bannerUrl,
        logo: v.logoUrl,
        rating: v.averageRating,
        reviewCount: v.totalReviews,
        isOpen: v.isOpen,
        address: v.address,
        // Using optional chaining/defaults for fields that might be missing
        positiveReviews: (v as any).positiveReviews,
        closesIn: (v as any).hoursSummary ?? null,
        isFavorite: true,
      };
    });
};

export const getFavoriteProducts = async (userId: string) => {
  const favorites = await prisma.favoriteProduct.findMany({
    where: { userId },
    include: {
      menuItem: {
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
          categories: { include: { category: { select: { name: true } } } },
        },
      },
    },
    orderBy: { id: "desc" },
  });

  return favorites.map((f) => ({
    id: f.menuItem.id,
    name: f.menuItem.name,
    description: f.menuItem.description,
    price: f.menuItem.price,
    isBestSeller: f.menuItem.isBestSeller,
    isFavorite: true,
    category: f.menuItem.categories[0]?.category.name ?? null,
    vendor: {
      id: f.menuItem.vendor.id,
      storeName: f.menuItem.vendor.storeName,
      logoUrl: f.menuItem.vendor.logoUrl,
      isOpen: f.menuItem.vendor.isOpen,
      averageRating: f.menuItem.vendor.averageRating,
    },
  }));
};

export const getRiderLocationForOrder = async (
  userId: string,
  orderId: string,
) => {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
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
