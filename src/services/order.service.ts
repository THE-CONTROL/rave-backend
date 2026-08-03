// src/services/order.service.ts
/**
 * Dedicated order lifecycle service shared by both user and vendor surfaces.
 * Owns the status state machine, cancellation window logic, and fires
 * the appropriate notification for every transition.
 */

import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { ORDER_STATUS_TRANSITIONS } from "../constants";
import { cfg } from "./config.service";
import * as notif from "../events/notification.events";
import { getCart } from "./user.service";

type OrderStatus =
  | "new"
  | "accepted"
  | "preparing"
  | "ready"
  | "ongoing"
  | "completed"
  | "cancelled";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const assertTransitionAllowed = (from: string, to: string): void => {
  const allowed = ORDER_STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw AppError.badRequest(
      `Cannot transition order from "${from}" to "${to}".`,
    );
  }
};

const isWithinCancelWindow = async (createdAt: Date): Promise<boolean> => {
  const windowSecs = await cfg.orders.cancelWindowSecs();
  const elapsed = (Date.now() - createdAt.getTime()) / 1000;
  return elapsed <= windowSecs;
};

// ─────────────────────────────────────────────────────────────────────────────
// User-initiated cancel
// ─────────────────────────────────────────────────────────────────────────────

export const cancelOrderByUser = async (
  userId: string,
  orderId: string,
  reason: string,
): Promise<void> => {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { vendor: { include: { user: true } }, items: true },
  });

  if (!order) throw AppError.notFound("Order");

  const CANCELLABLE = ["new", "accepted"];
  if (!CANCELLABLE.includes(order.status)) {
    throw AppError.badRequest(
      "This order can no longer be cancelled. Please contact support.",
    );
  }

  if (!(await isWithinCancelWindow(order.createdAt))) {
    throw AppError.badRequest(
      "The cancellation window has passed. Please contact support if you need help.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "cancelled", cancelledBy: "user" },
    });

    // The customer already paid — cancellation must create a real,
    // reviewable RefundRequest rather than the old fake "instant wallet
    // refund" claim. Vendors resolve this via the approve/decline endpoints.
    await tx.refundRequest.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        issue: "Order cancelled by customer",
        description: reason
          ? `Customer cancelled the order before it was prepared. Reason: ${reason}`
          : "Customer cancelled the order before it was prepared.",
        amountRequested: order.totalAmount,
        items: {
          create: order.items.map((item) => ({
            name: item.name,
            qty: item.qty,
          })),
        },
      },
    });
  });

  await notif.notifyOrderCancelled(userId, orderId, "user");

  // Notify vendor too
  await notif.notifyVendorOrderCancelled(order.vendor.userId, orderId);

  await notif.notifyAdminsNewRefundRequest(order.totalAmount);
};

// ─────────────────────────────────────────────────────────────────────────────
// Vendor status update — drives the full order lifecycle
// ─────────────────────────────────────────────────────────────────────────────

// Shared by both "mark ready" paths (advanceOrderStatus and
// uploadOrderEvidence) so the rider broadcast can never be skipped by
// whichever path a vendor's client happens to take.
const _notifyOrderReady = async (
  customerUserId: string,
  orderId: string,
  vendorStoreName: string,
  deliveryFee: number,
): Promise<void> => {
  await notif.notifyOrderReady(customerUserId, orderId);

  const onlineRiders = await prisma.riderProfile.findMany({
    where: { isOnline: true },
    select: { userId: true },
  });
  const commission = await cfg.fees.vendorCommission();
  await notif.notifyRiderNewOrderAvailable(
    onlineRiders.map((r) => r.userId),
    orderId,
    vendorStoreName,
    deliveryFee * (1 - commission),
  );
};

export const advanceOrderStatus = async (
  vendorUserId: string,
  orderId: string,
  newStatus: OrderStatus,
  cancelReason?: string,
): Promise<void> => {
  // Resolve vendor profile
  const vendor = await prisma.vendorProfile.findUnique({
    where: { userId: vendorUserId },
  });
  if (!vendor) throw AppError.notFound("Vendor profile");

  const order = await prisma.order.findFirst({
    where: { id: orderId, vendorId: vendor.id },
    include: { items: true },
  });
  if (!order) throw AppError.notFound("Order");

  assertTransitionAllowed(order.status, newStatus);

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: newStatus,
        // When the vendor moves an order to "cancelled" they are declining it,
        // so stamp who ended it. Analytics reads this to populate the
        // "Declined Orders" card (store) separately from customer cancels.
        ...(newStatus === "cancelled" ? { cancelledBy: "store" } : {}),
      },
    });

    // The customer already paid — a vendor decline/cancel still owes them a
    // real resolution, not a fake instant refund. Create a reviewable
    // RefundRequest the vendor (or eventually an admin) can approve/decline.
    if (newStatus === "cancelled") {
      await tx.refundRequest.create({
        data: {
          userId: order.userId,
          orderId: order.id,
          issue: "Order cancelled by vendor",
          description: cancelReason
            ? `The vendor declined/cancelled this order. Reason: ${cancelReason}`
            : "The vendor declined/cancelled this order.",
          amountRequested: order.totalAmount,
          items: {
            create: order.items.map((item) => ({
              name: item.name,
              qty: item.qty,
            })),
          },
        },
      });
    }
  });

  // ── Fire notifications based on new status ────────────────────────────────
  switch (newStatus) {
    case "accepted":
      await notif.notifyOrderAccepted(order.userId, orderId, vendor.storeName);
      break;
    case "preparing":
      await notif.notifyOrderPreparing(order.userId, orderId, vendor.storeName);
      break;
    case "ready":
      await _notifyOrderReady(order.userId, orderId, vendor.storeName, order.deliveryFee);
      break;
    case "completed":
      await notif.notifyOrderDelivered(order.userId, orderId);
      break;
    case "cancelled":
      await notif.notifyOrderCancelled(order.userId, orderId, "store");
      await notif.notifyAdminsNewRefundRequest(order.totalAmount);
      break;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Order tracking (user-facing)
// ─────────────────────────────────────────────────────────────────────────────

export const getOrderTracking = async (userId: string, orderId: string) => {
  const order = await prisma.order.findFirst({
    // Resolve by either the DB id (cuid, used by the order list) OR the
    // human-readable orderId (what createOrder returns to the checkout/result
    // flow). This keeps every entry point into tracking working.
    where: { userId, OR: [{ id: orderId }, { orderId }] },
    include: {
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
      items: {
        select: { name: true, qty: true, price: true },
      },
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

  const statusMessages: Record<string, string> = {
    new: "Waiting for the restaurant to accept your order.",
    accepted: "Order confirmed! The restaurant is preparing your food.",
    preparing: "Your food is being freshly prepared.",
    ready: "Food is ready! A rider is on the way to pick it up.",
    ongoing: "Your rider has picked up your order and is heading to you.",
    completed: "Delivered! Enjoy your meal.",
    cancelled: "This order has been cancelled.",
  };

  const rider = order.delivery?.rider;

  return {
    id: order.id,
    orderId: order.orderId,
    status: order.status,
    statusMessage: statusMessages[order.status] ?? "",
    estimatedArrival: order.estimatedArrival,
    etaDuration: order.etaDuration,
    deliveryAddress: order.deliveryAddress,
    deliveryLat: order.deliveryLat,
    deliveryLng: order.deliveryLng,
    deliveryInstructions: order.deliveryInstructions,
    contactMethod: order.contactMethod ?? "in-app",
    vendorOtpVerified: order.delivery?.vendorOtpVerified ?? false,
    user: {
      fullName: order.user.fullName,
      phone: order.user.phone,
      imageUrl: order.user.imageUrl,
    },
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
    restaurant: {
      name: order.vendor.storeName,
      image: order.vendor.logoUrl,
      address: order.vendor.address,
      lat: order.vendor.lat,
      lng: order.vendor.lng,
    },
    items: order.items,
    totalAmount: order.totalAmount,
    canCancel:
      ["new", "accepted"].includes(order.status) &&
      (await isWithinCancelWindow(order.createdAt)),
    cancelTimeLeft: (await isWithinCancelWindow(order.createdAt))
      ? Math.max(
          0,
          (await cfg.orders.cancelWindowSecs()) -
            Math.floor((Date.now() - order.createdAt.getTime()) / 1000),
        )
      : 0,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Reorder — add previous order's items back to cart
// ─────────────────────────────────────────────────────────────────────────────

export const reorder = async (
  userId: string,
  orderId: string,
): Promise<{ added: number; unavailable: string[] }> => {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { items: { include: { menuItem: true } } },
  });
  if (!order) throw AppError.notFound("Order");

  const unavailable: string[] = [];
  let added = 0;

  for (const item of order.items) {
    if (!item.menuItem.isActive) {
      unavailable.push(item.name);
      continue;
    }

    await prisma.cartItem.upsert({
      where: {
        userId_menuItemId: { userId, menuItemId: item.menuItemId },
      },
      create: { userId, menuItemId: item.menuItemId, qty: item.qty },
      update: { qty: { increment: item.qty } },
    });
    added++;
  }

  return { added, unavailable };
};

// ─────────────────────────────────────────────────────────────────────────────
// Order summary for checkout preview
// ─────────────────────────────────────────────────────────────────────────────

// Delegates to getCart's summary (the one real, actively-used implementation
// — it accounts for extras, option-group sizes, and promos) instead of
// re-deriving subtotal/vat/total from a naive price*qty sum, which silently
// disagreed with what checkout actually charges whenever extras or a promo
// were involved.
export const calculateCartSummary = async (userId: string) => {
  const { summary } = await getCart(userId);
  const vatRate = await cfg.fees.vatRate();

  if (!summary) {
    return {
      subtotal: 0,
      vat: 0,
      vatRate,
      deliveryFee: 0,
      serviceFee: 0,
      total: 0,
      itemCount: 0,
    };
  }

  return {
    subtotal: summary.subtotal,
    vat: summary.vat,
    vatRate,
    deliveryFee: summary.deliveryFee,
    serviceFee: summary.serviceFee,
    total: summary.total,
    itemCount: summary.itemCount,
  };
};

export const uploadOrderEvidence = async (
  vendorUserId: string,
  orderId: string,
  url: string, // Changed from OrderStatus to string
): Promise<{ success: boolean }> => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { userId: vendorUserId },
  });
  if (!vendor) throw AppError.notFound("Vendor profile");

  const order = await prisma.order.findFirst({
    where: { id: orderId, vendorId: vendor.id },
  });
  if (!order) throw AppError.notFound("Order");

  const newStatus: OrderStatus = "ready";

  // Ensure the transition is logical (e.g., Preparing -> Ready)
  if (order.status !== "ready") {
    assertTransitionAllowed(order.status, newStatus);

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: newStatus,
          packingVideoUrl: url, // ← was evidenceUrl: url, which destroyed the payment reference
          updatedAt: new Date(),
        },
      });
    });

    // This is the ONLY path a vendor's client actually calls to mark an
    // order ready (see takevideo.tsx) — it must fully replicate what
    // advanceOrderStatus's "ready" case does, including the rider
    // broadcast, or riders never get notified that food is ready.
    await _notifyOrderReady(order.userId, orderId, vendor.storeName, order.deliveryFee);
  }

  return { success: true };
};
