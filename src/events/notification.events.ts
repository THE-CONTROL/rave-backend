// src/events/notification.events.ts
/**
 * Centralised notification factory.
 * Every domain event that needs to push a notification calls a function here.
 * This keeps services clean and keeps notification logic in one place.
 */

import { prisma } from "../config/database";
import { logger } from "../config/logger";

interface NotificationPayload {
  userId: string;
  type: "order" | "rider" | "payment" | "promo" | "wallet";
  subType: "placed" | "approaching" | "delivered" | "general";
  title: string;
  message: string;
  icon?: string;
  iconBg?: string;
  orderId?: string;
  price?: number;
  code?: string;
  cancelWindow?: string;
}

const push = async (payload: NotificationPayload): Promise<void> => {
  try {
    await prisma.notification.create({ data: payload });
    // TODO: integrate Expo push notifications here
    // await sendPushNotification(user.pushToken, payload.title, payload.message);
  } catch (err) {
    // Non-fatal — log and continue
    logger.error("Failed to create notification", err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Order events (user-facing)
// ─────────────────────────────────────────────────────────────────────────────

export const notifyOrderPlaced = (
  userId: string,
  orderId: string,
  itemsSummary: string,
  totalAmount: number,
): Promise<void> =>
  push({
    userId,
    type: "order",
    subType: "placed",
    title: "Your Order has been placed.",
    message: itemsSummary,
    icon: "clipboard-outline",
    iconBg: "#FF9F0A",
    orderId,
    price: totalAmount,
    cancelWindow: "4:59",
  });

export const notifyOrderAccepted = (
  userId: string,
  orderId: string,
  storeName: string,
): Promise<void> =>
  push({
    userId,
    type: "order",
    subType: "placed",
    title: "Order Accepted!",
    message: `${storeName} has accepted your order and is preparing it.`,
    icon: "checkmark-circle-outline",
    iconBg: "#007AFF",
    orderId,
  });

export const notifyOrderReady = (
  userId: string,
  orderId: string,
): Promise<void> =>
  push({
    userId,
    type: "order",
    subType: "placed",
    title: "Order Ready for Pickup",
    message: "A rider has been assigned and is on the way.",
    icon: "bicycle-outline",
    iconBg: "#FF9F0A",
    orderId,
  });

export const notifyOrderDelivered = (
  userId: string,
  orderId: string,
): Promise<void> =>
  push({
    userId,
    type: "order",
    subType: "delivered",
    title: "Your order has been delivered!",
    message: "Enjoy your meal 🍽️ Don't forget to leave a review.",
    icon: "checkmark-circle-outline",
    iconBg: "#34C759",
    orderId,
  });

export const notifyOrderCancelled = (
  userId: string,
  orderId: string,
  cancelledBy: "user" | "store",
): Promise<void> =>
  push({
    userId,
    type: "order",
    subType: "general",
    title:
      cancelledBy === "store" ? "Order Cancelled by Store" : "Order Cancelled",
    message:
      cancelledBy === "store"
        ? "The store cancelled your order. A full refund will be processed to your wallet."
        : "Your order has been cancelled.",
    icon: "close-circle-outline",
    iconBg: "#FF3B30",
    orderId,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Order events (vendor-facing)
// ─────────────────────────────────────────────────────────────────────────────

export const notifyVendorNewOrder = (
  vendorUserId: string,
  orderId: string,
  customerName: string,
  itemsSummary: string,
  totalAmount: number,
): Promise<void> =>
  push({
    userId: vendorUserId,
    type: "order",
    subType: "placed",
    title: "New Order Received",
    message: `${customerName} just placed an order.\n${itemsSummary}`,
    icon: "clipboard-outline",
    iconBg: "#FF9F0A",
    orderId,
    price: totalAmount,
  });

export const notifyVendorOrderCancelled = (
  vendorUserId: string,
  orderId: string,
): Promise<void> =>
  push({
    userId: vendorUserId,
    type: "order",
    subType: "general",
    title: "Order Cancelled by Customer",
    message: "A customer has cancelled their order.",
    icon: "close-circle-outline",
    iconBg: "#FF3B30",
    orderId,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Payment / wallet events
// ─────────────────────────────────────────────────────────────────────────────

export const notifyRefundProcessed = (
  userId: string,
  amount: number,
): Promise<void> =>
  push({
    userId,
    type: "payment",
    subType: "general",
    title: "Refund Processed ✅",
    message: `₦${amount.toLocaleString()} has been added to your wallet.`,
    icon: "wallet-outline",
    iconBg: "#34C759",
  });

// ─────────────────────────────────────────────────────────────────────────────
// Referral events
// ─────────────────────────────────────────────────────────────────────────────

export const notifyReferralBonus = (
  userId: string,
  bonusAmount: number,
  refereeName: string,
): Promise<void> =>
  push({
    userId,
    type: "payment",
    subType: "general",
    title: "Referral Bonus Earned! 🎉",
    message: `${refereeName} completed their first order. ₦${bonusAmount.toLocaleString()} added to your wallet.`,
    icon: "gift-outline",
    iconBg: "#7F56D9",
  });

// ─────────────────────────────────────────────────────────────────────────────
// Order events — extended
// ─────────────────────────────────────────────────────────────────────────────

export const notifyOrderPreparing = (
  userId: string,
  orderId: string,
  storeName: string,
): Promise<void> =>
  push({
    userId,
    type: "order",
    subType: "general",
    title: "Your food is being prepared 👨‍🍳",
    message: `${storeName} is now preparing your order.`,
    icon: "restaurant-outline",
    iconBg: "#FF9F0A",
    orderId,
  });

export const notifyPromoApplied = (
  userId: string,
  promoCode: string,
  discountAmount: number,
): Promise<void> =>
  push({
    userId,
    type: "promo",
    subType: "general",
    title: "Promo Applied! 🎉",
    message: `${promoCode} saved you ₦${discountAmount.toLocaleString()} on this order.`,
    icon: "pricetag-outline",
    iconBg: "#7F56D9",
    code: promoCode,
    price: discountAmount,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Rider events
// ─────────────────────────────────────────────────────────────────────────────

export const notifyRiderAssigned = (
  userId: string,
  orderId: string,
  riderName: string,
): Promise<void> =>
  push({
    userId,
    type: "rider",
    subType: "approaching",
    title: "Rider assigned 🛵",
    message: `${riderName} has accepted your order and is on the way.`,
    icon: "bicycle-outline",
    iconBg: "#007AFF",
    orderId,
  });

export const notifyRiderNewOrderAvailable = async (
  riderUserIds: string[],
  orderId: string,
  storeName: string,
  earnings: number,
): Promise<void> => {
  await Promise.all(
    riderUserIds.map((userId) =>
      push({
        userId,
        type: "order",
        subType: "general",
        title: "New delivery available 📦",
        message: `Order from ${storeName} — earn ₦${Math.round(earnings).toLocaleString()}`,
        icon: "bag-outline",
        iconBg: "#34C759",
        orderId,
      }),
    ),
  );
};

export const notifyRiderDeliveryAccepted = (
  userId: string,
  orderId: string,
  storeName: string,
): Promise<void> =>
  push({
    userId,
    type: "order",
    subType: "general",
    title: "Delivery confirmed ✅",
    message: `Head to ${storeName} to pick up the order.`,
    icon: "navigate-outline",
    iconBg: "#34C759",
    orderId,
  });

export const notifyRiderEarningsCredited = (
  userId: string,
  amount: number,
): Promise<void> =>
  push({
    userId,
    type: "payment",
    subType: "general",
    title: "Earnings credited 💰",
    message: `₦${Math.round(amount).toLocaleString()} has been added to your available balance.`,
    icon: "wallet-outline",
    iconBg: "#34C759",
    price: amount,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Vendor events — extended
// ─────────────────────────────────────────────────────────────────────────────

export const notifyVendorReviewReceived = (
  vendorUserId: string,
  rating: number,
  comment?: string | null,
): Promise<void> =>
  push({
    userId: vendorUserId,
    type: "order",
    subType: "general",
    title: `New ${rating}-star review ⭐`,
    message: comment
      ? `A customer said: "${comment.slice(0, 80)}${comment.length > 80 ? "…" : ""}"`
      : "You received a new review from a customer.",
    icon: "star-outline",
    iconBg: "#FF9F0A",
  });

export const notifyVendorRiderArrived = (
  vendorUserId: string,
  orderId: string,
  riderName: string,
): Promise<void> =>
  push({
    userId: vendorUserId,
    type: "rider",
    subType: "approaching",
    title: "Rider has arrived 🛵",
    message: `${riderName} is at your store to pick up the order.`,
    icon: "bicycle-outline",
    iconBg: "#007AFF",
    orderId,
  });
