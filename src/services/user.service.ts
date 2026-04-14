// src/services/user.service.ts
import bcrypt from "bcryptjs";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { buildMeta, parsePagination } from "../utils";
import { CheckoutDto, PaginationQuery } from "../types";
import { UserNotificationSettingsPayload } from "../types/notifications";
import { cfg } from "./config.service";
import * as notif from "../events/notification.events";
import { encrypt } from "../utils/crypto";

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
// Addresses
// ─────────────────────────────────────────────────────────────────────────────

export const getAddresses = (userId: string) =>
  prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

export const getAddressById = async (userId: string, addressId: string) => {
  const address = await prisma.address.findFirst({
    where: { id: addressId, userId },
  });
  if (!address) throw AppError.notFound("Address");
  return address;
};

export const addAddress = (
  userId: string,
  data: { label: string; address: string; note?: string },
) => prisma.address.create({ data: { userId, ...data } });

export const updateAddress = async (
  userId: string,
  addressId: string,
  data: { label?: string; address?: string; note?: string },
) => {
  const existing = await prisma.address.findFirst({
    where: { id: addressId, userId },
  });
  if (!existing) throw AppError.notFound("Address");
  return prisma.address.update({ where: { id: addressId }, data });
};

export const setDefaultAddress = async (
  userId: string,
  addressId: string,
): Promise<void> => {
  await prisma.$transaction([
    prisma.address.updateMany({
      where: { userId },
      data: { isDefault: false },
    }),
    prisma.address.update({
      where: { id: addressId },
      data: { isDefault: true },
    }),
  ]);
};

export const deleteAddress = async (
  userId: string,
  addressId: string,
): Promise<void> => {
  const existing = await prisma.address.findFirst({
    where: { id: addressId, userId },
  });
  if (!existing) throw AppError.notFound("Address");
  await prisma.address.delete({ where: { id: addressId } });
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
// Wallet
// ─────────────────────────────────────────────────────────────────────────────

export const getWallet = async (userId: string) => {
  const [wallet, vatRate, commissionRate] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId } }),
    cfg.fees.vatRate(),
    cfg.fees.vendorCommission(),
  ]);
  if (!wallet) throw AppError.notFound("Wallet");
  return {
    id: wallet.id,
    available: wallet.available,
    pending: wallet.pending,
    vatRate,
    commissionRate,
  };
};

export const getSavedCards = (userId: string) =>
  prisma.savedCard.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

export const saveCard = (
  userId: string,
  data: {
    brand: string;
    last4: string;
    expMonth: string;
    expYear: string;
    cardHolder: string;
    email?: string;
  },
) => prisma.savedCard.create({ data: { userId, ...data } });

export const deleteCard = async (
  userId: string,
  cardId: string,
): Promise<void> => {
  const card = await prisma.savedCard.findFirst({
    where: { id: cardId, userId },
  });
  if (!card) throw AppError.notFound("Card");
  await prisma.savedCard.delete({ where: { id: cardId } });
};

export const setDefaultCard = async (
  userId: string,
  cardId: string,
): Promise<void> => {
  await prisma.$transaction([
    prisma.savedCard.updateMany({
      where: { userId },
      data: { isDefault: false },
    }),
    prisma.savedCard.update({
      where: { id: cardId },
      data: { isDefault: true },
    }),
  ]);
};

export const getSavedBanks = (userId: string) =>
  prisma.bankAccount.findMany({ where: { userId } });

export const addBankAccount = (
  userId: string,
  data: {
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
  },
) => prisma.bankAccount.create({ data: { userId, ...data } });

export const topUpWallet = async (
  userId: string,
  amount: number,
): Promise<void> => {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) throw AppError.notFound("Wallet");

  await prisma.$transaction([
    prisma.wallet.update({
      where: { userId },
      data: { available: { increment: amount } },
    }),
    prisma.transaction.create({
      data: {
        userId,
        type: "top_up",
        status: "successful",
        title: "Wallet Top Up",
        amount,
        previousBalance: wallet.available,
        balanceAfter: wallet.available + amount,
      },
    }),
  ]);
};

export const requestWithdrawal = async (
  userId: string,
  amount: number,
  bankId: string,
): Promise<{ ref: string }> => {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) throw AppError.notFound("Wallet");
  if (wallet.available < amount) {
    throw AppError.badRequest("Insufficient wallet balance.");
  }

  const bank = await prisma.bankAccount.findFirst({
    where: { id: bankId, userId },
  });
  if (!bank) throw AppError.notFound("Bank account");

  const tx = await prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { userId },
      data: { available: { decrement: amount } },
    });
    return tx.transaction.create({
      data: {
        userId,
        type: "withdrawal",
        status: "successful",
        title: `Withdrawal to ${bank.bankName}`,
        amount: -amount,
        previousBalance: wallet.available,
        balanceAfter: wallet.available - amount,
      },
    });
  });

  return { ref: tx.reference ?? "" };
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
      items: { include: { menuItem: true } },
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
          name: order.riderName ?? rider.user?.fullName ?? "",
          phone: order.riderPhone ?? rider.user?.phone ?? "",
          code: order.riderCode ?? null,
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
  dto: CheckoutDto,
): Promise<{ orderId: string; discountAmount: number }> => {
  const cartItems = await prisma.cartItem.findMany({
    where: { userId },
    include: { menuItem: true },
  });
  if (!cartItems.length) throw AppError.badRequest("Your cart is empty.");

  // ── Resolve delivery coordinates and address string ───────────────────────
  // Either an existing Address row or a SavedLocation (converted on the fly)
  let deliveryAddress: string;
  let deliveryLat: number | null = null;
  let deliveryLng: number | null = null;

  if (dto.addressId) {
    const address = await prisma.address.findFirst({
      where: { id: dto.addressId, userId },
    });
    if (!address) throw AppError.notFound("Delivery address");
    deliveryAddress = address.address;
    deliveryLat = address.lat ?? null;
    deliveryLng = address.lng ?? null;
  } else if (dto.savedLocationId) {
    const loc = await prisma.savedLocation.findFirst({
      where: { id: dto.savedLocationId, userId },
    });
    if (!loc) throw AppError.notFound("Saved location");

    // Upsert an Address row so there's a persistent delivery record and the
    // user's pinned location shows up in their address history
    const upserted = await prisma.address.upsert({
      where: {
        // Use a stable compound identifier — same location re-used = same row
        // We store lat/lng as part of the label to make it unique per pin
        id: `loc_${loc.id}`,
      },
      update: {
        address: loc.description,
        lat: loc.latitude,
        lng: loc.longitude,
      },
      create: {
        id: `loc_${loc.id}`, // deterministic id — no duplicates
        userId,
        label: loc.name,
        address: loc.description,
        lat: loc.latitude,
        lng: loc.longitude,
        isDefault: false,
        note: loc.instructions ?? null,
      },
    });
    deliveryAddress = upserted.address;
    deliveryLat = upserted.lat ?? null;
    deliveryLng = upserted.lng ?? null;
  } else {
    throw AppError.badRequest(
      "A delivery address or saved location is required.",
    );
  }

  // Validate all items from the same vendor
  const vendorIds = [...new Set(cartItems.map((ci) => ci.menuItem.vendorId))];
  if (vendorIds.length > 1)
    throw AppError.badRequest(
      "All cart items must be from the same restaurant.",
    );

  const vendorId = vendorIds[0];
  const subtotal = cartItems.reduce(
    (s, ci) => s + ci.menuItem.price * ci.qty,
    0,
  );

  const [deliveryFee, vatRate, serviceFee] = await Promise.all([
    cfg.fees.deliveryBase(),
    cfg.fees.vatRate(),
    cfg.fees.serviceFee(),
  ]);
  const vat = Math.round(subtotal * vatRate);

  // Apply promo code if provided
  let discountAmount = 0;
  let promotionId: string | undefined;
  let promoCode: string | undefined;

  if (dto.promoCode) {
    const result = await applyPromoCode(
      userId,
      dto.promoCode,
      subtotal,
      vendorId,
    );
    if (!result.valid) throw AppError.badRequest(result.message);
    discountAmount = result.discountAmount;
    promotionId = result.promotionId;
    promoCode = dto.promoCode.trim().toUpperCase();
  }

  const total =
    Math.max(0, subtotal - discountAmount) + deliveryFee + vat + serviceFee;

  const order = await prisma.$transaction(async (tx) => {
    if (dto.paymentMethod === "wallet") {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet || wallet.available < total)
        throw AppError.badRequest("Insufficient wallet balance.");
      await tx.wallet.update({
        where: { userId },
        data: { available: { decrement: total } },
      });
    }

    const newOrder = await tx.order.create({
      data: {
        userId,
        vendorId,
        totalAmount: total,
        deliveryFee,
        vat,
        serviceFee,
        // discountAmount,
        // promoCode: promoCode ?? null,
        // promotionId: promotionId ?? null,
        paymentMethod: dto.paymentMethod as "wallet" | "card" | "bank_transfer",
        deliveryAddress,
        deliveryLat,
        deliveryLng,
        deliveryInstructions: dto.instructions ?? null,
        contactMethod: dto.contactMethod ?? "in-app",
        items: {
          create: cartItems.map((ci) => ({
            menuItemId: ci.menuItemId,
            name: ci.menuItem.name,
            qty: ci.qty,
            price: ci.menuItem.price,
          })),
        },
      },
    });

    await tx.transaction.create({
      data: {
        userId,
        orderId: newOrder.id,
        type: "order_payment",
        status: "successful",
        title: promoCode
          ? `Order Payment (${promoCode} — ₦${discountAmount.toLocaleString()} off)`
          : "Order Payment",
        amount: -total,
      },
    });

    if (promotionId) {
      await tx.promotion.update({
        where: { id: promotionId },
        data: { timesUsed: { increment: 1 } },
      });
    }

    // await tx.cartItem.deleteMany({ where: { userId } });
    return newOrder;
  });

  // Fire notifications after transaction succeeds
  const itemsSummary = cartItems
    .map((ci) => `${ci.qty}x ${ci.menuItem.name}`)
    .join(", ");

  await notif.notifyOrderPlaced(userId, order.orderId, itemsSummary, total);

  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: { userId: true, storeName: true },
  });
  if (vendor) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    await notif.notifyVendorNewOrder(
      vendor.userId,
      order.orderId,
      user?.fullName ?? "A customer",
      itemsSummary,
      total,
    );
  }

  if (promotionId && discountAmount > 0 && promoCode) {
    await notif.notifyPromoApplied(userId, promoCode, discountAmount);
  }

  return { orderId: order.orderId, discountAmount };
};

// ─────────────────────────────────────────────────────────────────────────────
// Cart
// ─────────────────────────────────────────────────────────────────────────────

export const getCart = (userId: string) =>
  prisma.cartItem.findMany({
    where: { userId },
    include: { menuItem: true },
  });

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
      where: { userId, type: "referral_bonus", status: "successful" },
      _sum: { amount: true },
    }),
  ]);

  return {
    referralCode: user.referralCode,
    totalReferrals: referrals.length,
    amountEarned: totalEarned._sum.amount ?? 0,
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

  await prisma.favoriteProduct.create({ data: { userId, menuItemId } });
  return { isFavorite: true };
};

// ─────────────────────────────────────────────────────────────────────────────
// Bank account CRUD (user)
// ─────────────────────────────────────────────────────────────────────────────

export const getBankAccountById = async (userId: string, bankId: string) => {
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankId, userId },
  });
  if (!account) throw AppError.notFound("Bank account");
  return account;
};

export const updateBankAccount = async (
  userId: string,
  bankId: string,
  data: {
    bankName?: string;
    bankCode?: string;
    accountNumber?: string;
    accountName?: string;
  },
): Promise<void> => {
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankId, userId },
  });
  if (!account) throw AppError.notFound("Bank account");
  await prisma.bankAccount.update({ where: { id: bankId }, data });
};

export const setDefaultBank = async (
  userId: string,
  bankId: string,
): Promise<void> => {
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankId, userId },
  });
  if (!account) throw AppError.notFound("Bank account");
  await prisma.$transaction([
    prisma.bankAccount.updateMany({
      where: { userId },
      data: { isDefault: false },
    }),
    prisma.bankAccount.update({
      where: { id: bankId },
      data: { isDefault: true },
    }),
  ]);
};

export const deleteBankAccount = async (
  userId: string,
  bankId: string,
): Promise<void> => {
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankId, userId },
  });
  if (!account) throw AppError.notFound("Bank account");
  await prisma.bankAccount.delete({ where: { id: bankId } });
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
    imageUrl: f.menuItem.imageUrl,
    isBestSeller: f.menuItem.isBestSeller,
    calories: f.menuItem.calories,
    prepTime: f.menuItem.prepTime,
    serves: f.menuItem.serves,
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
