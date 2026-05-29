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
import { PaymentMethod } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Profile Completion
// ─────────────────────────────────────────────────────────────────────────────

const recalculateProfileCompletion = async (userId: string): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { imageUrl: true, location: true },
  });
  if (!user) return;

  let completion = 0;
  if (user.imageUrl) completion += 50;
  if (user.location) completion += 50;

  await prisma.user.update({
    where: { id: userId },
    data: { profileCompletion: completion },
  });
};

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
  const updated = await prisma.user.update({
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

  if (data.imageUrl || data.location) {
    await recalculateProfileCompletion(userId);
  }

  return updated;
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

export const upsertLocation = async (
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
  const result = locationId
    ? await prisma.savedLocation.update({ where: { id: locationId }, data })
    : await prisma.savedLocation.create({ data: { userId, ...data } });

  await prisma.user.update({
    where: { id: userId },
    data: { location: data.description },
  });

  await recalculateProfileCompletion(userId);

  return result;
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

/**
 * Maps a DB transaction (TransactionType enum: payment | order | refund | referral)
 * to a UI-friendly object the frontend already expects:
 *   payment  → "top_up"           (wallet funding)
 *   order    → "order_payment"    (paid for an order)
 *   refund   → "refund"
 *   referral → "referral_reward"
 *
 * Adds the formatted strings, icon metadata, balance snapshots, and
 * type-specific contextual fields (restaurant/itemsSummary/deliveryAddress
 * for orders; referralName/remark for referrals; etc.) so the detail screen
 * and the history list render without missing data.
 */
const UI_TYPE_MAP: Record<string, string> = {
  payment: "top_up",
  order: "order_payment",
  refund: "refund",
  referral: "referral_reward",
};

const ICON_META: Record<
  string,
  { icon: string; iconBg: string; isCredit: boolean }
> = {
  top_up: { icon: "arrow-down", iconBg: "#ECFDF5", isCredit: true },
  order_payment: { icon: "arrow-up", iconBg: "#FEF3F2", isCredit: false },
  refund: { icon: "arrow-down", iconBg: "#ECFDF5", isCredit: true },
  referral_reward: { icon: "gift", iconBg: "#ECFDF5", isCredit: true },
};

const formatUserTransaction = (tx: any, extras?: any) => {
  const uiType = UI_TYPE_MAP[tx.type] ?? tx.type;
  const meta = ICON_META[uiType] ?? {
    icon: "swap-horizontal",
    iconBg: "#F2F4F7",
    isCredit: false,
  };

  const signedAmount = meta.isCredit
    ? Math.abs(tx.amount)
    : -Math.abs(tx.amount);

  const formattedDate = tx.createdAt.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
  const formattedTime = tx.createdAt.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  // Per-type contextual fields the detail screen reads off the txn.
  const ctx: Record<string, any> = {};

  if (uiType === "order_payment" && extras?.order) {
    const o = extras.order;
    ctx.orderId = o.orderId ?? null;
    ctx.restaurant = extras.vendorName ?? null;
    ctx.itemsSummary = extras.itemsSummary ?? null;
    ctx.paymentSource = tx.paymentMethod ?? "Card";
    ctx.deliveryAddress = o.deliveryAddress ?? null;
  }

  if (uiType === "refund" && extras?.order) {
    ctx.refundType = tx.title ?? "Refund";
    ctx.orderId = extras.order.orderId ?? null;
    ctx.refundedTo = tx.paymentMethod ?? "Original payment method";
    ctx.reason = tx.reason ?? null;
    ctx.deliveryAddress = extras.order.deliveryAddress ?? null;
  }

  if (uiType === "referral_reward") {
    ctx.referralName = extras?.referralName ?? tx.customerName ?? null;
    ctx.remark = tx.reason ?? tx.title ?? null;
  }

  if (uiType === "top_up") {
    ctx.bankName = extras?.bankName ?? null;
    ctx.senderName = extras?.senderName ?? tx.customerName ?? null;
    ctx.senderAccount = extras?.senderAccount ?? null;
  }

  return {
    id: tx.id,
    type: uiType,
    status: tx.status,
    title: tx.title,
    amount: signedAmount,
    formattedAmount: `${meta.isCredit ? "+" : "-"}₦${Math.abs(tx.amount).toLocaleString()}`,
    paymentMethod: tx.paymentMethod ?? null,
    reference: tx.reference ?? null,
    icon: meta.icon,
    iconBg: meta.iconBg,

    // Balance snapshots — kept on the row when the detail screen needs them.
    // Falls back to 0 when not tracked (no wallet ledger column exists yet).
    previousBalance: extras?.previousBalance ?? 0,
    balanceAfter: extras?.balanceAfter ?? 0,

    // Date strings the UI uses directly
    date: formattedDate,
    time: formattedTime,
    formattedDate,
    formattedTime,
    createdAt: tx.createdAt,

    // Linked order summary — the list card shows vendor + items inline
    order: extras?.order
      ? {
          id: extras.order.id,
          orderId: extras.order.orderId,
          vendor: extras.vendorName ?? null,
          vendorLogo: extras.vendorLogo ?? null,
          items: extras.itemsSummary ?? null,
          status: extras.order.status,
        }
      : null,

    ...ctx,
  };
};

export const getTransactions = async (
  userId: string,
  query: PaginationQuery & { type?: string },
) => {
  const { page, limit, skip } = parsePagination(query);

  // Accept both the UI-friendly type names AND the DB enum names so the
  // tab filter on the history screen ("Orders", "Refunds", "Referrals")
  // doesn't have to know about the enum drift.
  const FILTER_MAP: Record<string, string> = {
    top_up: "payment",
    order_payment: "order",
    referral_reward: "referral",
    refund: "refund",
    payment: "payment",
    order: "order",
    referral: "referral",
  };

  const rawType = query.type;
  const typeFilter =
    rawType && rawType !== "all" && FILTER_MAP[rawType]
      ? (FILTER_MAP[rawType] as any)
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
      include: {
        order: {
          select: {
            id: true,
            orderId: true,
            status: true,
            deliveryAddress: true,
            vendor: { select: { storeName: true, logoUrl: true } },
            items: { select: { name: true, qty: true } },
          },
        },
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  const formatted = transactions.map((tx: any) => {
    const order = tx.order
      ? {
          id: tx.order.id,
          orderId: tx.order.orderId,
          status: tx.order.status,
          deliveryAddress: tx.order.deliveryAddress,
        }
      : null;

    const itemsSummary = tx.order?.items?.length
      ? tx.order.items.map((i: any) => `${i.qty}x ${i.name}`).join(", ")
      : null;

    return formatUserTransaction(tx, {
      order,
      vendorName: tx.order?.vendor?.storeName ?? null,
      vendorLogo: tx.order?.vendor?.logoUrl ?? null,
      itemsSummary,
    });
  });

  return { transactions: formatted, meta: buildMeta(total, page, limit) };
};

export const getTransactionById = async (userId: string, txId: string) => {
  const tx = await prisma.transaction.findFirst({
    where: { id: txId, userId },
    include: {
      order: {
        select: {
          id: true,
          orderId: true,
          status: true,
          deliveryAddress: true,
          vendor: { select: { storeName: true, logoUrl: true } },
          items: { select: { name: true, qty: true } },
        },
      },
    },
  });
  if (!tx) throw AppError.notFound("Transaction");

  const order = tx.order
    ? {
        id: tx.order.id,
        orderId: tx.order.orderId,
        status: tx.order.status,
        deliveryAddress: tx.order.deliveryAddress,
      }
    : null;

  const itemsSummary = tx.order?.items?.length
    ? tx.order.items.map((i: any) => `${i.qty}x ${i.name}`).join(", ")
    : null;

  return formatUserTransaction(tx, {
    order,
    vendorName: tx.order?.vendor?.storeName ?? null,
    vendorLogo: tx.order?.vendor?.logoUrl ?? null,
    itemsSummary,
  });
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
        items: {
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                images: {
                  where: { isMain: true },
                  take: 1,
                  select: { url: true },
                },
              },
            },
          },
        },
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
      items: {
        include: {
          menuItem: {
            include: {
              images: true,
              ingredients: true,
            },
          },
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
        menuItem: item.menuItem,
        resolvedExtras,
        extrasTotal: resolvedExtras.reduce((sum, e) => sum + e.price, 0),
      };
    }),
    deliveryInstructions: order.deliveryInstructions,
    contactMethod: order.contactMethod ?? "in-app",
    rider: rider
      ? {
          name: rider.user?.fullName ?? "",
          phone: rider.user?.phone ?? "",
          image: rider.user?.imageUrl ?? null,
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

// ─────────────────────────────────────────────────────────────────────────────
// Create Order — called AFTER payment is confirmed by polling
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateOrderInput {
  savedLocationId: string;
  paymentMethod: string;
  instructions?: string;
  contactMethod?: string;
  reference: string; // Paystack reference — stored as evidence
}

export const createOrder = async (
  userId: string,
  dto: CreateOrderInput,
): Promise<{ orderId: string }> => {
  // ── Idempotency: prevent duplicate orders for the same payment ─────────────
  const existingOrder = await prisma.order.findFirst({
    where: { evidenceUrl: dto.reference },
    select: { orderId: true },
  });
  if (existingOrder) {
    // Already created — return the existing order (safe to call multiple times)
    return { orderId: existingOrder.orderId };
  }

  const { items, summary } = await getCart(userId);
  if (!items.length || !summary) {
    throw AppError.badRequest("Cart is empty. Cannot create order.");
  }

  const loc = await prisma.savedLocation.findFirst({
    where: { id: dto.savedLocationId, userId },
  });
  if (!loc) throw AppError.notFound("Saved location");

  const vendorId = items[0].menuItem.vendorId;

  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: { autoAcceptOrders: true },
  });

  const initialStatus = vendor?.autoAcceptOrders ? "preparing" : "new";
  const etaMinutes = 25;
  const arrivalTime = new Date();
  arrivalTime.setMinutes(arrivalTime.getMinutes() + etaMinutes);

  const order = await prisma.order.create({
    data: {
      userId,
      vendorId,
      totalAmount: summary.total,
      deliveryFee: summary.deliveryFee || 0,
      vat: summary.vat || 0,
      serviceFee: summary.serviceFee || 0,
      // Combine auto-promo (per item) + code-promo (cart level) into the
      // single discountAmount column the order detail screens read.
      discountAmount:
        (summary.discountAmount || 0) + (summary.promoDiscount || 0),
      promoCode: summary.promoCode ?? null,
      paymentMethod: dto.paymentMethod as PaymentMethod,
      status: initialStatus,
      estimatedArrival: arrivalTime,
      etaDuration: etaMinutes,
      evidenceUrl: dto.reference, // ← Paystack reference as evidence
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
          extras: item.extras ?? [],
        })),
      },
    },
  });

  // ── Mark promo usage + clear the applied code now that it's consumed ───────
  if (summary.promoCode) {
    await prisma.promotion.updateMany({
      where: { promoCode: summary.promoCode, vendorId },
      data: { timesUsed: { increment: 1 } },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { appliedPromoCode: null },
    });
  }

  // Clear cart now that order is created
  await prisma.cartItem.deleteMany({ where: { userId } });

  // Link the FIN_ transaction to this order if it exists
  await prisma.transaction.updateMany({
    where: {
      reference: `FIN_${dto.reference}`,
      orderId: null,
    },
    data: { orderId: order.id },
  });

  const itemsSummary = items
    .map((i) => `${i.qty}x ${i.menuItem.name}`)
    .join(", ");
  notif.notifyOrderPlaced(userId, order.orderId, itemsSummary, summary.total);

  return { orderId: order.orderId };
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
  const result = await _evaluatePromo(code, subtotal, vendorId);

  // Persist the code on the user only when it's valid, so getCart and
  // checkout can re-evaluate it against the live cart.
  if (result.valid) {
    await prisma.user.update({
      where: { id: userId },
      data: { appliedPromoCode: code.trim().toUpperCase() },
    });
  }

  return result;
};

// Pure evaluation — no persistence. Reused by getCart and checkout.
const _evaluatePromo = async (
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

// Clear an applied promo code from the user's cart.
export const removePromoCode = async (userId: string): Promise<void> => {
  await prisma.user.update({
    where: { id: userId },
    data: { appliedPromoCode: null },
  });
};

export const processCheckout = async (
  userId: string,
  dto: CheckoutInput,
): Promise<{
  orderId: string;
  paymentUrl?: string;
  reference: string;
}> => {
  const { items, summary } = await getCart(userId);

  if (!items.length || !summary) {
    throw AppError.badRequest("Your cart is empty.");
  }

  const loc = await prisma.savedLocation.findFirst({
    where: { id: dto.savedLocationId, userId },
  });
  if (!loc) throw AppError.notFound("Saved location");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) throw AppError.notFound("User not found");

  const vendorId = items[0].menuItem.vendorId;

  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: {
      autoAcceptOrders: true,
      isOpen: true,
      storeStatus: true,
      storeName: true,
    },
  });

  // ── Re-check vendor availability at payment time ───────────────────────────
  // The vendor may have closed between adding to cart and checking out.
  // Block before taking payment, not after.
  // if (!vendor || vendor.storeStatus !== "open" || !vendor.isOpen) {
  if (!vendor || !vendor.isOpen) {
    throw AppError.badRequest(
      `${vendor?.storeName ?? "This restaurant"} is now closed and isn't accepting orders. You have not been charged.`,
    );
  }

  const initialStatus = vendor.autoAcceptOrders ? "preparing" : "new";

  const order = await prisma.$transaction(async (tx) => {
    const etaMinutes = 25;
    const arrivalTime = new Date();
    arrivalTime.setMinutes(arrivalTime.getMinutes() + etaMinutes);

    return await tx.order.create({
      data: {
        userId,
        vendorId,
        totalAmount: summary.total,
        deliveryFee: summary.deliveryFee || 0,
        vat: summary.vat || 0,
        serviceFee: summary.serviceFee || 0,
        discountAmount:
          (summary.discountAmount || 0) + (summary.promoDiscount || 0),
        paymentMethod: dto.paymentMethod,
        status: initialStatus,
        estimatedArrival: arrivalTime,
        etaDuration: etaMinutes,
        evidenceUrl: "",
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
            extras: item.extras ?? [],
          })),
        },
      },
    });
  });

  const payment = await paymentService.initializeCheckout(
    user.email,
    summary.total,
    dto.paymentMethod as "card" | "bank_transfer",
    "order",
    vendorId,
    userId,
    order.id,
  );

  // Mark promo usage + clear the applied code now that it's consumed.
  if (summary.promoCode) {
    await prisma.promotion.updateMany({
      where: { promoCode: summary.promoCode, vendorId },
      data: { timesUsed: { increment: 1 } },
    });
  }
  await prisma.user.update({
    where: { id: userId },
    data: { appliedPromoCode: null },
  });

  await prisma.cartItem.deleteMany({ where: { userId } });

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
  const cartItems = await prisma.cartItem.findMany({
    where: { userId },
    include: {
      menuItem: {
        include: {
          images: { orderBy: { isMain: "desc" } },
          ingredients: true,
        },
      },
    },
  });

  if (cartItems.length === 0) return { items: [], summary: null };

  const vendorId = cartItems[0].menuItem.vendorId;
  const now = new Date();

  const activePromos = await prisma.promotion.findMany({
    where: {
      vendorId,
      isActive: true,
      startDate: { lte: now },
      endDate: { gte: now },
      promoCode: null,
    },
  });

  let runningBaseSubtotal = 0;
  let runningExtrasTotal = 0;
  let runningDiscountTotal = 0;

  const mappedItems = cartItems.map((item) => {
    const basePrice = item.menuItem.price;

    const extras = item.extras as any;
    let extrasPrice = 0;
    const selectedExtras: { id: string; name: string; price: number }[] = [];

    if (extras && item.menuItem.ingredients.length > 0) {
      const selectedIds: string[] = Array.isArray(extras)
        ? extras
        : typeof extras === "object"
          ? Object.keys(extras).filter((k) => extras[k] === true)
          : [];

      for (const ing of item.menuItem.ingredients) {
        if (ing.isOptional && selectedIds.includes(ing.id)) {
          const ingPrice = ing.price ?? 0;
          extrasPrice += ingPrice;
          selectedExtras.push({ id: ing.id, name: ing.name, price: ingPrice });
        }
      }
    }

    const promo = activePromos.find(
      (p) => p.appliesTo === "all" || p.productIds.includes(item.menuItemId),
    );

    let discountPerUnit = 0;
    let discountLabel: string | null = null;

    if (promo && promo.discountValue) {
      if (promo.type === "percentage_discount") {
        discountPerUnit = basePrice * (promo.discountValue / 100);
        discountLabel = `${promo.discountValue}% off`;
      } else if (promo.type === "fixed_discount") {
        discountPerUnit = Math.min(promo.discountValue, basePrice);
        discountLabel = `₦${promo.discountValue} off`;
      }
    }

    const originalUnitPrice = basePrice + extrasPrice;
    const discountedBasePrice = basePrice - discountPerUnit;
    const currentUnitPrice = discountedBasePrice + extrasPrice;

    const baseSubtotalForItem = basePrice * item.qty;
    const extrasTotalForItem = extrasPrice * item.qty;
    const discountForItem = discountPerUnit * item.qty;

    runningBaseSubtotal += baseSubtotalForItem;
    runningExtrasTotal += extrasTotalForItem;
    runningDiscountTotal += discountForItem;

    return {
      id: item.id,
      qty: item.qty,
      extras: item.extras,
      selectedExtras,
      extrasPrice,
      discountLabel,
      originalPrice: originalUnitPrice,
      currentPrice: currentUnitPrice,
      menuItem: {
        id: item.menuItem.id,
        name: item.menuItem.name,
        price: item.menuItem.price,
        vendorId: item.menuItem.vendorId,
        images: item.menuItem.images.map((img) => ({
          url: img.url,
          isMain: img.isMain,
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

  const taxableAmount =
    runningBaseSubtotal - runningDiscountTotal + runningExtrasTotal;

  // ── User-entered promo code (persisted on the user) ──────────────────────
  // Auto-promos above already discounted individual items. The code promo
  // applies on top, at the cart level, against the post-auto-discount subtotal.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { appliedPromoCode: true },
  });

  let codeDiscount = 0;
  let appliedPromo: { code: string; label: string } | null = null;

  if (user?.appliedPromoCode) {
    const evald = await _evaluatePromo(
      user.appliedPromoCode,
      taxableAmount,
      vendorId,
    );
    if (evald.valid) {
      codeDiscount = Math.min(evald.discountAmount, taxableAmount);
      appliedPromo = {
        code: user.appliedPromoCode,
        label: `Promo ${user.appliedPromoCode}`,
      };
    } else {
      // Code became invalid (expired, cart dropped below minimum, etc.)
      // Clear it silently so the user isn't stuck with a dead code.
      await prisma.user.update({
        where: { id: userId },
        data: { appliedPromoCode: null },
      });
    }
  }

  const discountedTaxable = taxableAmount - codeDiscount;
  const vatAmount = discountedTaxable * vatRate;
  const finalTotal = discountedTaxable + vatAmount + serviceFee + deliveryBase;

  return {
    items: mappedItems,
    summary: {
      subtotal: runningBaseSubtotal,
      extrasTotal: runningExtrasTotal,
      discountAmount: runningDiscountTotal, // auto-promo, per item
      promoCode: appliedPromo?.code ?? null,
      promoLabel: appliedPromo?.label ?? null,
      promoDiscount: codeDiscount, // code-promo, cart level
      taxableAmount: discountedTaxable,
      vat: vatAmount,
      serviceFee,
      deliveryFee: deliveryBase,
      total: finalTotal,
      itemCount: mappedItems.length,
    },
  };
};

export const addToCart = async (
  userId: string,
  menuItemId: string,
  qty: number,
  extras?: string[],
): Promise<void> => {
  const item = await prisma.menuItem.findUnique({
    where: { id: menuItemId },
    include: {
      vendor: { select: { isOpen: true, storeStatus: true, storeName: true } },
    },
  });
  if (!item || !item.isActive) throw AppError.notFound("Menu item");

  // ── Reject if the vendor is closed or not currently accepting orders ───────
  // storeStatus must be "open" (not paused/deactivated/under_review/denied),
  // AND the vendor's manual open toggle must be on.
  // if (item.vendor.storeStatus !== "open" || !item.vendor.isOpen) {
  if (!item.vendor.isOpen) {
    throw AppError.badRequest(
      `${item.vendor.storeName} is currently closed and isn't accepting orders right now.`,
    );
  }

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
    create: {
      userId,
      menuItemId,
      qty,
      extras: extras ?? [],
    },
    update: {
      qty: { increment: qty },
      ...(extras !== undefined ? { extras } : {}),
    },
  });
};

export const updateCartItem = async (
  userId: string,
  menuItemId: string,
  qty: number,
  extras?: string[],
): Promise<void> => {
  if (qty <= 0) {
    await prisma.cartItem.deleteMany({ where: { userId, menuItemId } });
    return;
  }
  await prisma.cartItem.upsert({
    where: { userId_menuItemId: { userId, menuItemId } },
    create: {
      userId,
      menuItemId,
      qty,
      extras: extras ?? [],
    },
    update: {
      qty,
      ...(extras !== undefined ? { extras } : {}),
    },
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
    where: {
      id: data.orderId,
      userId,
      OR: [
        { status: "completed" as const },
        { delivery: { is: { status: "delivered" } } },
      ],
    },
  });
  if (!order)
    throw AppError.badRequest("You can only review a delivered order.");

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

export const getReferralStats = async (
  userId: string,
  query: PaginationQuery = {},
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (!user) throw AppError.notFound("User");

  const { page, limit, skip } = parsePagination(query);

  const [referrals, totalReferrals, totalEarned, pendingReferrals] =
    await Promise.all([
      prisma.referral.findMany({
        where: { referrerId: userId },
        include: { referee: { select: { fullName: true, imageUrl: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.referral.count({ where: { referrerId: userId } }),
      prisma.transaction.aggregate({
        where: { userId, type: "referral", status: "completed" },
        _sum: { amount: true },
      }),
      prisma.referral.count({
        where: { referrerId: userId, status: "pending" },
      }),
    ]);

  return {
    referralCode: user.referralCode,
    totalReferrals,
    amountEarned: totalEarned._sum?.amount ?? 0,
    pendingReferrals,
    referrals,
    meta: buildMeta(totalReferrals, page, limit),
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

  const menuItem = await prisma.menuItem.findUniqueOrThrow({
    where: { id: menuItemId },
    select: { vendorId: true },
  });

  await prisma.favoriteProduct.create({
    data: { userId, menuItemId, vendorId: menuItem.vendorId },
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
// Home — usual orders
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

export const getFavoriteRestaurants = async (
  userId: string,
  query: PaginationQuery = {},
) => {
  const { page, limit, skip } = parsePagination(query);

  const [favorites, total] = await Promise.all([
    prisma.favoriteRestaurant.findMany({
      where: { userId },
      include: { vendor: true },
      orderBy: { id: "desc" },
      skip,
      take: limit,
    }),
    prisma.favoriteRestaurant.count({ where: { userId } }),
  ]);

  const data = favorites
    .filter((f) => f.vendor)
    .map((f) => {
      const v = f.vendor;
      return {
        id: v.id,
        name: v.storeName,
        image: v.bannerUrl ?? null,
        logo: v.logoUrl ?? null,
        rating: v.averageRating,
        reviewCount: v.totalReviews,
        isOpen: v.isOpen,
        address: v.address ?? null,
        deliveryTime: "25-35 mins",
        deliveryFee: 0,
        positiveReviews: v.positiveReviews ?? 0,
        closesIn: v.hoursSummary ?? null,
        isYourUsual: false,
        isFavorite: true,
      };
    });

  return { data, meta: buildMeta(total, page, limit) };
};

export const getFavoriteProducts = async (
  userId: string,
  query: PaginationQuery = {},
) => {
  const { page, limit, skip } = parsePagination(query);

  const [favorites, total] = await Promise.all([
    prisma.favoriteProduct.findMany({
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
            images: true,
            ingredients: true,
            categories: {
              include: { category: { select: { id: true, name: true } } },
            },
          },
        },
      },
      orderBy: { id: "desc" },
      skip,
      take: limit,
    }),
    prisma.favoriteProduct.count({ where: { userId } }),
  ]);

  const data = favorites.map((f) => ({
    id: f.menuItem.id,
    name: f.menuItem.name,
    description: f.menuItem.description ?? null,
    price: f.menuItem.price,
    isActive: f.menuItem.isActive,
    isBestSeller: f.menuItem.isBestSeller,
    isCustomizable: f.menuItem.isCustomizable,
    images: f.menuItem.images.map((img) => ({
      id: img.id,
      url: img.url,
      isMain: img.isMain,
    })),
    ingredients: f.menuItem.ingredients.map((ing) => ({
      id: ing.id,
      name: ing.name,
      portion: ing.portion,
      mealType: ing.mealType,
      isOptional: ing.isOptional,
      price: ing.price ?? 0,
    })),
    rating: 0,
    reviewCount: 0,
    isFavorite: true,
    vendor: {
      id: f.menuItem.vendor.id,
      storeName: f.menuItem.vendor.storeName,
      logoUrl: f.menuItem.vendor.logoUrl ?? null,
      isOpen: f.menuItem.vendor.isOpen,
      averageRating: f.menuItem.vendor.averageRating,
    },
    categories: f.menuItem.categories.map((c) => ({
      category: { id: c.category.id, name: c.category.name },
    })),
    customGroups: [],
  }));

  return { data, meta: buildMeta(total, page, limit) };
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
