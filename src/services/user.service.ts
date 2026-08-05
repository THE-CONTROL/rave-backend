// src/services/user.service.ts
import bcrypt from "bcryptjs";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import {
  buildMeta,
  parsePagination,
  resolveDateRange,
  resolveSort,
} from "../utils";
import { CheckoutInput, PaginationQuery } from "../types";
import { UserNotificationSettingsPayload } from "../types/notifications";
import { cfg } from "./config.service";
import * as notif from "../events/notification.events";
import * as paymentService from "../services/payment.service";
import { PaymentMethod } from "@prisma/client";
import { evaluateVendorBadges } from "./badgeEvaluation.service";

// ─────────────────────────────────────────────────────────────────────────────
// Cart/order `extras` Json parsing — shared by getCart and getOrderById
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedExtras {
  ids: string[];
  quantities: Record<string, number>;
}

/**
 * `extras` has taken two shapes over time: a flat array of ids (ingredients +
 * choice_selector size ids), and now `{ids, quantities}` once quantity_selector
 * groups needed somewhere to put a chosen number. Historical cart/order rows
 * may still hold the old flat-array shape, so both are handled here rather
 * than migrating existing data.
 */
const parseCartExtras = (raw: unknown): ParsedExtras => {
  if (Array.isArray(raw)) return { ids: raw as string[], quantities: {} };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.ids)) {
      return {
        ids: obj.ids as string[],
        quantities:
          obj.quantities && typeof obj.quantities === "object"
            ? (obj.quantities as Record<string, number>)
            : {},
      };
    }
    // Even older legacy shape: an object map of id -> true.
    return {
      ids: Object.keys(obj).filter((k) => obj[k] === true),
      quantities: {},
    };
  }
  return { ids: [], quantities: {} };
};

/** extraCost = one `pricePerExtra` charge per full `quantityPerExtra` block
 * above `baseQuantity`, clamped to [minQuantity, maxQuantity] server-side —
 * the chosen quantity is never trusted/priced from the client directly. */
const priceQuantitySelector = (
  group: {
    id: string;
    name: string;
    baseQuantity: number | null;
    pricePerExtra: number | null;
    quantityPerExtra: number | null;
    minQuantity: number | null;
    maxQuantity: number | null;
  },
  requestedQty: number,
): { qty: number; cost: number } | null => {
  const base = group.baseQuantity ?? 0;
  const min = group.minQuantity ?? base;
  const max = group.maxQuantity ?? Number.POSITIVE_INFINITY;
  const qty = Math.min(Math.max(requestedQty, min), max);

  if (qty === base) return null; // nothing extra chosen — no line item needed

  const perExtra = group.quantityPerExtra || 1;
  const pricePerExtra = group.pricePerExtra ?? 0;
  const extraUnits = Math.max(0, qty - base);
  const cost = Math.floor(extraUnits / perExtra) * pricePerExtra;

  return { qty, cost };
};

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

  // A stolen refresh token shouldn't survive a legitimate password change.
  await prisma.refreshToken.deleteMany({ where: { userId } });
};

export const deleteAccount = async (userId: string): Promise<void> => {
  await prisma.user.update({
    where: { id: userId },
    data: {
      isActive: false,
      email: `deleted_${userId}@rave.com`,
      // `phone` is unique at the DB level with no format constraint, so a
      // namespaced placeholder (mirroring the email rewrite above) frees the
      // real phone number for reuse on a future signup instead of locking it
      // out forever.
      phone: `deleted_${userId}`,
    },
  });

  // Deactivating the account should kill any existing session immediately,
  // not just block future logins.
  await prisma.refreshToken.deleteMany({ where: { userId } });
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
  // Mirrors setPrimaryBank/setVendorPrimaryBank: when this location is being
  // marked default, clear `isDefault` on every other one of the user's
  // locations in the same transaction so at most one row can ever be default.
  let result;
  if (data.isDefault) {
    const [, upserted] = await prisma.$transaction([
      prisma.savedLocation.updateMany({
        where: {
          userId,
          ...(locationId ? { id: { not: locationId } } : {}),
        },
        data: { isDefault: false },
      }),
      locationId
        ? prisma.savedLocation.update({ where: { id: locationId }, data })
        : prisma.savedLocation.create({ data: { userId, ...data } }),
    ]);
    result = upserted;
  } else {
    result = locationId
      ? await prisma.savedLocation.update({ where: { id: locationId }, data })
      : await prisma.savedLocation.create({ data: { userId, ...data } });
  }

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
  query: PaginationQuery & { type?: string; range?: string; sort?: string },
) => {
  const { page, limit, skip } = parsePagination(query);

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

  // Hide pending transactions superseded by a completed FIN_ row.
  const shadowedRefs = await prisma.transaction
    .findMany({
      where: {
        userId,
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
    userId,
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
  query: PaginationQuery & { status?: string; range?: string; sort?: string },
) => {
  const { page, limit, skip } = parsePagination(query);

  // Valid OrderStatus enum values. The Completed tab used to ask for
  // "completed,delivered", but "delivered" is a DeliveryStatus, NOT an
  // OrderStatus — passing it into `status: { in: [...] }` makes Prisma throw,
  // which broke the whole Completed query (so completed orders showed nowhere).
  const VALID_ORDER_STATUSES = [
    "new",
    "accepted",
    "preparing",
    "ready",
    "ongoing",
    "completed",
    "cancelled",
  ];

  const statuses =
    query.status && query.status !== "all"
      ? query.status
          .split(",")
          .map((s) => s.trim())
          .filter((s) => VALID_ORDER_STATUSES.includes(s))
      : [];

  const where = {
    userId,
    ...(statuses.length === 1
      ? { status: statuses[0] as any }
      : statuses.length > 1
        ? { status: { in: statuses as any[] } }
        : {}),
    ...resolveDateRange(query.range),
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
      orderBy: { createdAt: resolveSort(query.sort) },
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, meta: buildMeta(total, page, limit) };
};

export const getOrderById = async (userId: string, orderId: string) => {
  const order = await prisma.order.findFirst({
    // Resolve by EITHER the DB id (uuid) or the human-readable orderId (cuid),
    // because the review screens navigate with order.orderId while the order
    // list uses order.id. Matching only `id` made those screens fail to load.
    where: { userId, OR: [{ id: orderId }, { orderId }] },
    include: {
      items: {
        include: {
          menuItem: {
            include: {
              images: true,
              ingredients: true,
              optionGroups: {
                include: { options: { include: { sizes: true } } },
              },
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
      const { ids: extrasIds, quantities } = parseCartExtras(item.extras);

      const resolvedExtras = item.menuItem.ingredients
        .filter((ing) => extrasIds.includes(ing.id))
        .map((ing) => ({
          id: ing.id,
          name: ing.name,
          price: ing.price ?? 0,
        }));

      // Also resolve any chosen reusable option-group sizes so the receipt
      // shows (and totals) paid options like "Large" or add-ons, matching what
      // the cart charged at checkout.
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

      // quantity_selector groups: same re-derivation as getCart, from the
      // quantity recorded in extras.quantities at checkout time.
      for (const group of item.menuItem.optionGroups ?? []) {
        if (group.customizationType !== "quantity_selector") continue;
        const requestedQty = quantities[group.id];
        if (requestedQty === undefined) continue;

        const priced = priceQuantitySelector(group, requestedQty);
        if (!priced) continue;

        resolvedExtras.push({
          id: group.id,
          name: `${group.name} (x${priced.qty})`,
          price: priced.cost,
        });
      }

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
    // Confirmation media for the order details screen: the vendor's packing
    // video and the rider's pickup/delivery proof photos. Exposed as a stable
    // shape so the client doesn't have to reach into the delivery relation.
    confirmationMedia: {
      packingVideoUrl: order.packingVideoUrl ?? null,
      pickupProofUrl: order.delivery?.pickupProofUrl ?? null,
      deliveryProofUrl: order.delivery?.deliveryProofUrl ?? null,
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
    select: { autoAcceptOrders: true, userId: true, storeName: true },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true },
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

  // New — notify vendor of incoming order
  if (vendor?.userId) {
    notif.notifyVendorNewOrder(
      vendor.userId,
      order.orderId,
      user?.fullName ?? "A customer",
      itemsSummary,
      summary.total,
    );
  }

  // New — notify customer of promo applied (only if they used one)
  if (summary.promoCode && (summary.promoDiscount ?? 0) > 0) {
    notif.notifyPromoApplied(
      userId,
      summary.promoCode,
      summary.promoDiscount ?? 0,
    );
  }

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
          optionGroups: {
            include: {
              options: { include: { sizes: true } },
            },
          },
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

    const { ids: selectedIds, quantities } = parseCartExtras(item.extras);
    let extrasPrice = 0;
    const selectedExtras: { id: string; name: string; price: number }[] = [];

    if (item.menuItem.ingredients.length > 0) {
      for (const ing of item.menuItem.ingredients) {
        if (ing.isOptional && selectedIds.includes(ing.id)) {
          const ingPrice = ing.price ?? 0;
          extrasPrice += ingPrice;
          selectedExtras.push({ id: ing.id, name: ing.name, price: ingPrice });
        }
      }
    }

    // Reusable option-group selections: the customer's chosen option sizes are
    // stored as ids inside `extras.ids` too. Resolve them against the item's
    // attached groups and add each chosen size's extraPrice, so a "Large" or a
    // paid add-on actually changes what the customer is charged.
    if (selectedIds.length > 0) {
      for (const group of item.menuItem.optionGroups ?? []) {
        for (const opt of group.options ?? []) {
          for (const size of opt.sizes ?? []) {
            if (selectedIds.includes(size.id) && size.extraPrice > 0) {
              extrasPrice += size.extraPrice;
              selectedExtras.push({
                id: size.id,
                name: `${opt.name} · ${size.name}`,
                price: size.extraPrice,
              });
            }
          }
        }
      }
    }

    // quantity_selector groups have no ids/sizes of their own — the chosen
    // number lives in `extras.quantities`, priced against the group's own
    // baseQuantity/pricePerExtra/quantityPerExtra terms.
    for (const group of item.menuItem.optionGroups ?? []) {
      if (group.customizationType !== "quantity_selector") continue;
      const requestedQty = quantities[group.id];
      if (requestedQty === undefined) continue;

      const priced = priceQuantitySelector(group, requestedQty);
      if (!priced) continue;

      extrasPrice += priced.cost;
      selectedExtras.push({
        id: group.id,
        name: `${group.name} (x${priced.qty})`,
        price: priced.cost,
      });
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
  extras?: { ids: string[]; quantities?: Record<string, number> },
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
  if (item.vendor.storeStatus !== "open" || !item.vendor.isOpen) {
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
      extras: extras ?? { ids: [] },
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
  extras?: { ids: string[]; quantities?: Record<string, number> },
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
      extras: extras ?? { ids: [] },
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
    riderComment?: string;
    proofUrls?: string[];
    menuItemIds?: string[];
    resolutionPreference?: string;
  },
): Promise<void> => {
  // Loosened eligibility: accept either fully-completed orders OR orders the
  // rider has physically dropped off (delivery.delivered). Mirrors the list
  // query in myReviews.service.ts so what surfaces in the pending list can
  // actually be reviewed.
  //
  // Resolve by EITHER the DB id (uuid) OR the human-readable orderId (cuid).
  // Earlier this only matched `id`, so whenever a screen passed the human
  // orderId the lookup silently failed and the review never saved — that was
  // the "it won't save" bug. Everything downstream now uses the resolved
  // `order.id`, never the raw input.
  const order = await prisma.order.findFirst({
    where: {
      userId,
      OR: [{ id: data.orderId }, { orderId: data.orderId }],
      AND: {
        OR: [
          { status: "completed" as const },
          { delivery: { is: { status: "delivered" } } },
        ],
      },
    },
  });
  if (!order)
    throw AppError.badRequest("You can only review a delivered order.");

  const existing = await prisma.review.findUnique({
    where: { orderId: order.id },
  });
  if (existing)
    throw AppError.conflict("You have already reviewed this order.");

  // Overall score is derived, not collected: the average of the three parts.
  const overallRating = Math.round(
    (data.restaurantRating + data.foodRating + data.riderRating) / 3,
  );

  // Link the review to every menu item on the order so it surfaces on each
  // product's reviews feed. Earlier this relied on the client passing
  // `menuItemIds`, which it never did — so `menuItemIds` was always empty and
  // product/food reviews never appeared anywhere. We now derive it from the
  // order itself (union with any explicit ids the client did send).
  const orderItems = await prisma.orderItem.findMany({
    where: { orderId: order.id },
    select: { menuItemId: true },
  });
  const derivedMenuItemIds = Array.from(
    new Set([
      ...orderItems.map((i) => i.menuItemId),
      ...(data.menuItemIds ?? []),
    ]),
  );

  await prisma.review.create({
    data: {
      userId,
      vendorId: order.vendorId,
      orderId: order.id,
      restaurantRating: data.restaurantRating,
      foodRating: data.foodRating,
      riderRating: data.riderRating,
      overallRating,
      tags: data.tags ?? [],
      comment: data.comment,
      riderComment: data.riderComment,
      proofUrls: data.proofUrls ?? [],
      // proofUrls keeps per-part prefixes ("vendor:<url>"); images is the plain
      // URL list for any generic viewer that doesn't care about the part.
      images: (data.proofUrls ?? []).map((u) => {
        const i = u.indexOf(":");
        return i > 0 ? u.slice(i + 1) : u;
      }),
      menuItemIds: derivedMenuItemIds,
      resolutionPreference: data.resolutionPreference,
    },
  });

  // ── Recompute the vendor's cached averageRating ────────────────────────────
  // Uses (restaurant + food) / 2 — both vendor-controlled. riderRating is
  // intentionally excluded; that's the rider's responsibility, not the
  // vendor's, and folding it in would penalise vendors for rider behaviour.
  const allReviews = await prisma.review.findMany({
    where: { vendorId: order.vendorId },
    select: { restaurantRating: true, foodRating: true },
  });

  const totalReviews = allReviews.length;
  const sum = allReviews.reduce(
    (acc, r) => acc + (r.restaurantRating + r.foodRating) / 2,
    0,
  );
  const newAvg =
    totalReviews > 0 ? parseFloat((sum / totalReviews).toFixed(1)) : 0;

  const positiveReviews = allReviews.filter(
    (r) => (r.restaurantRating + r.foodRating) / 2 >= 4,
  ).length;

  await prisma.vendorProfile.update({
    where: { id: order.vendorId },
    data: { averageRating: newAvg, totalReviews, positiveReviews },
  });
  await evaluateVendorBadges(order.vendorId);

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

  // ── Keep the rider's cached average in sync ────────────────────────────────
  // Now that the rider score is collected independently of the vendor score,
  // refresh the assigned rider's cached averageRating/totalReviews so their
  // profile stat matches what the live reviews feed computes.
  const delivery = await prisma.delivery.findUnique({
    where: { orderId: order.id },
    select: { riderId: true },
  });
  if (delivery?.riderId) {
    const riderReviews = await prisma.review.findMany({
      where: { order: { delivery: { riderId: delivery.riderId } } },
      select: { riderRating: true },
    });
    const rTotal = riderReviews.length;
    const rAvg =
      rTotal > 0
        ? parseFloat(
            (
              riderReviews.reduce((a, r) => a + r.riderRating, 0) / rTotal
            ).toFixed(1),
          )
        : 0;
    await prisma.riderProfile.update({
      where: { id: delivery.riderId },
      data: { averageRating: rAvg, totalReviews: rTotal },
    });
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

  const [refunds, total, statusCounts] = await Promise.all([
    prisma.refundRequest.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.refundRequest.count({ where }),
    // Per-status totals across the user's ENTIRE refund history (not just the
    // currently-loaded page), so the filter pill counts on the frontend are
    // always accurate instead of only reflecting whatever pages have been
    // scrolled into view so far.
    prisma.refundRequest.groupBy({
      by: ["status"],
      where: { userId },
      _count: { _all: true },
    }),
  ]);

  const counts = {
    all: 0,
    IN_REVIEW: 0,
    APPROVED: 0,
    REFUNDED: 0,
    DECLINED: 0,
  };
  for (const row of statusCounts) {
    counts[row.status] = row._count._all;
    counts.all += row._count._all;
  }

  return { refunds, meta: buildMeta(total, page, limit), counts };
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

  const refund = await prisma.refundRequest.create({
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

  await notif.notifyAdminsNewRefundRequest(data.amountRequested);

  return refund;
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

/**
 * Pays out a referral once the referee completes a qualifying order. Called at
 * the single delivery-completion point. Credits both the referee and the
 * referrer with the configured bonus (recorded as `referral` transactions,
 * which is exactly what the wallet/earnings totals aggregate) and flips the
 * referral to "successful". Idempotent via `bonusPaid`, and never throws into
 * the completion flow — referral payout must not block a delivery finishing.
 */
export const applyReferralReward = async (
  refereeId: string,
  orderAmount: number,
): Promise<void> => {
  const referral = await prisma.referral.findUnique({
    where: { refereeId },
  });
  if (!referral || referral.bonusPaid) return;

  const minOrder = await cfg.referral.minOrderAmount();
  if (orderAmount < minOrder) return;

  const refereeBonus = await cfg.referral.refereeBonus();
  const referrerBonus = await cfg.referral.referrerBonus();

  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction to avoid a double payout on a race.
    const fresh = await tx.referral.findUnique({ where: { refereeId } });
    if (!fresh || fresh.bonusPaid) return;

    await tx.referral.update({
      where: { refereeId },
      data: { status: "successful", bonusPaid: true },
    });

    await tx.transaction.create({
      data: {
        userId: refereeId,
        type: "referral",
        status: "completed",
        title: "Referral Bonus",
        amount: refereeBonus,
      },
    });
    await tx.transaction.create({
      data: {
        userId: referral.referrerId,
        type: "referral",
        status: "completed",
        title: "Referral Bonus",
        amount: referrerBonus,
      },
    });
  });
};

/**
 * Role-aware referral settlement. Unlike `applyReferralReward` (the fast path
 * fired the moment a *customer* order completes), this works for every role —
 * a rider or vendor referee never places an order, so their referrer would
 * otherwise never be paid. The "qualifying activity" is therefore chosen per
 * role:
 *   • user   → a completed order worth at least the configured minimum
 *   • rider  → at least one delivery actually dropped off
 *   • vendor → at least one order they fulfilled to completion
 *
 * When the referee qualifies, both sides are credited the configured bonus
 * (recorded as `referral` transactions so wallet/earnings totals pick them up)
 * and the referrer is notified. Idempotent via `bonusPaid`, and it swallows
 * its own errors so a referral hiccup can never break the caller.
 */
export const settleReferralIfQualified = async (
  refereeId: string,
): Promise<void> => {
  try {
    const referral = await prisma.referral.findUnique({
      where: { refereeId },
      include: {
        referee: { select: { role: true, fullName: true } },
      },
    });
    if (!referral || referral.bonusPaid) return;

    const role = referral.referee.role;
    let qualifies = false;

    if (role === "user") {
      const minOrder = await cfg.referral.minOrderAmount();
      const order = await prisma.order.findFirst({
        where: {
          userId: refereeId,
          status: "completed",
          totalAmount: { gte: minOrder },
        },
        select: { id: true },
      });
      qualifies = !!order;
    } else if (role === "rider") {
      const delivery = await prisma.delivery.findFirst({
        where: { status: "delivered", rider: { userId: refereeId } },
        select: { id: true },
      });
      qualifies = !!delivery;
    } else if (role === "vendor") {
      const order = await prisma.order.findFirst({
        where: { status: "completed", vendor: { userId: refereeId } },
        select: { id: true },
      });
      qualifies = !!order;
    }

    if (!qualifies) return;

    const refereeBonus = await cfg.referral.refereeBonus();
    const referrerBonus = await cfg.referral.referrerBonus();

    await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction so two job ticks can't double-pay.
      const fresh = await tx.referral.findUnique({ where: { refereeId } });
      if (!fresh || fresh.bonusPaid) return;

      await tx.referral.update({
        where: { refereeId },
        data: { status: "successful", bonusPaid: true },
      });

      await tx.transaction.create({
        data: {
          userId: refereeId,
          type: "referral",
          status: "completed",
          title: "Referral Bonus",
          amount: refereeBonus,
        },
      });
      await tx.transaction.create({
        data: {
          userId: referral.referrerId,
          type: "referral",
          status: "completed",
          title: "Referral Bonus",
          amount: referrerBonus,
        },
      });
    });

    await notif
      .notifyReferralBonus(
        referral.referrerId,
        referrerBonus,
        referral.referee.fullName,
      )
      .catch(() => {});
  } catch {
    // Referral settlement is best-effort and must never surface to the caller.
  }
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

export const getUnreadNotificationCount = async (
  userId: string,
): Promise<{ count: number }> => {
  const count = await prisma.notification.count({
    where: { userId, isRead: false },
  });
  return { count };
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
        // No distance context here — see catalog.search. Null lets the card
        // hide the time instead of showing an absolute, inaccurate value.
        deliveryTime: null,
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
