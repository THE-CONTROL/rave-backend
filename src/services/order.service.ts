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
    include: { vendor: { include: { user: true } } },
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
      data: { status: "cancelled", cancelReason: reason, cancelledBy: "user" },
    });
  });

  await notif.notifyOrderCancelled(userId, orderId, "user");

  // Notify vendor too
  await notif.notifyVendorOrderCancelled(order.vendor.userId, orderId);
};

// ─────────────────────────────────────────────────────────────────────────────
// Vendor status update — drives the full order lifecycle
// ─────────────────────────────────────────────────────────────────────────────

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
  });
  if (!order) throw AppError.notFound("Order");

  assertTransitionAllowed(order.status, newStatus);

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: newStatus,
        // ...(newStatus === "cancelled"
        //   ? { cancelReason, cancelledBy: "store" }
        //   : {}),
        // ...(newStatus === "ready" ? { pickupTime: new Date() } : {}),
        // ...(newStatus === "completed" ? { deliveryTime: new Date() } : {}),
      },
    });
  });

  // ── Fire notifications based on new status ────────────────────────────────
  switch (newStatus) {
    case "accepted":
      await notif.notifyOrderAccepted(order.userId, orderId, vendor.storeName);
      break;
    case "ready": {
      await notif.notifyOrderReady(order.userId, orderId);
      // Broadcast to all online riders
      const onlineRiders = await prisma.riderProfile.findMany({
        where: { isOnline: true },
        select: { userId: true },
      });
      const commission = await cfg.fees.vendorCommission();
      await notif.notifyRiderNewOrderAvailable(
        onlineRiders.map((r) => r.userId),
        orderId,
        vendor.storeName,
        order.deliveryFee * (1 - commission),
      );
      break;
    }
    case "completed":
      await notif.notifyOrderDelivered(order.userId, orderId);
      break;
    case "cancelled":
      await notif.notifyOrderCancelled(order.userId, orderId, "store");
      break;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Order tracking (user-facing)
// ─────────────────────────────────────────────────────────────────────────────

export const getOrderTracking = async (userId: string, orderId: string) => {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
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

export const calculateCartSummary = async (userId: string) => {
  const cartItems = await prisma.cartItem.findMany({
    where: { userId },
    include: { menuItem: true },
  });

  if (!cartItems.length) {
    return {
      subtotal: 0,
      vat: 0,
      deliveryFee: 0,
      serviceFee: 0,
      total: 0,
      itemCount: 0,
    };
  }

  const subtotal = cartItems.reduce(
    (s, ci) => s + ci.menuItem.price * ci.qty,
    0,
  );
  const [vatRate, deliveryFee, serviceFee] = await Promise.all([
    cfg.fees.vatRate(),
    cfg.fees.deliveryBase(),
    cfg.fees.serviceFee(),
  ]);
  const vat = Math.round(subtotal * vatRate);
  const total = subtotal + vat + deliveryFee + serviceFee;

  return {
    subtotal,
    vat,
    deliveryFee,
    serviceFee,
    total,
    itemCount: cartItems.reduce((s, ci) => s + ci.qty, 0),
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
  assertTransitionAllowed(order.status, newStatus);

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: newStatus,
        evidenceUrl: url, // Save the Cloudinary URL
        ...(newStatus === "ready" ? { readyAt: new Date() } : {}),
      },
    });

    // Notify customer that the order is now ready for pickup
    await notif.notifyOrderReady(order.userId, orderId);
  }); // Added missing closing brace and parenthesis for transaction

  return { success: true };
};
