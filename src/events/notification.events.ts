// src/events/notification.events.ts
/**
 * Centralised notification factory.
 * Every domain event that needs to push a notification calls a function here.
 * This keeps services clean and keeps notification logic in one place.
 */

import { AdminRole, NotificationSettings } from "@prisma/client";
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { sendPush } from "@/utils/push";

// Settings fields that can gate a notification. Naming the field directly on
// each notification (via `category`) is far more reliable than inferring it
// from the coarse type:subType pair — several notifications legitimately share
// a type:subType but belong to different toggles.
type SettingsKey = keyof Omit<
  NotificationSettings,
  "id" | "userId" | "user" | "sound" | "createdAt" | "updatedAt"
>;

interface NotificationPayload {
  userId: string;
  type: "order" | "rider" | "payment" | "promo" | "wallet" | "account";
  subType: "placed" | "approaching" | "delivered" | "general";
  title: string;
  message: string;
  icon?: string;
  iconBg?: string;
  orderId?: string;
  price?: number;
  code?: string;
  cancelWindow?: string;
  // Which user/vendor toggle controls this notification. Omit for
  // system-critical alerts the user cannot opt out of (cancellations,
  // refunds, payouts, delivery confirmations). `category` is NOT persisted —
  // it only drives the send-time gate below.
  category?: SettingsKey;
}

const push = async (payload: NotificationPayload): Promise<void> => {
  try {
    // `category` is a control field, not a column — strip it before persisting.
    const { category, ...record } = payload;

    const notification = await prisma.notification.create({ data: record });

    // Look up push token, settings, AND role in one query. `role` drives the
    // deep-link target below — the three client apps map 1:1 to a role
    // (user/vendor → Rave, rider → RideWithRave).
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        pushToken: true,
        notificationSettings: true,
        role: true,
      },
    });

    if (!user?.pushToken) return;

    // Gate on the explicit category. If this notification declares a category
    // and the user has that toggle off, keep the in-app record but skip the
    // push. No category → always delivered (system-critical).
    if (category && user.notificationSettings) {
      const enabled = (user.notificationSettings as any)[category];
      if (enabled === false) {
        return;
      }
    }

    // Resolve user's chosen sound to what Expo expects in the push payload.
    // "silent" → send with sound: null (no audio).
    // "default" → system default sound.
    // Anything else → expect a bundled file name (e.g. "ring") and append .wav
    //   since iOS in particular requires the extension in the push payload.
    const userSoundCode = user.notificationSettings?.sound ?? "default";

    // iOS plays the payload sound directly. Android ignores it and plays the
    // sound bound to the notification CHANNEL, so we also send a channelId that
    // matches the user's choice. The client creates one channel per sound.
    let pushSound: "default" | string | null;
    let channelId: string;
    if (userSoundCode === "silent") {
      pushSound = null;
      channelId = "silent";
    } else if (userSoundCode === "default") {
      pushSound = "default";
      channelId = "default";
    } else {
      pushSound = `${userSoundCode}.wav`;
      channelId = `sound_${userSoundCode}`;
    }

    // Deep-link target for tapping the OS push notification, mirroring the
    // exact routes wired up for tapping the in-app notification list row in
    // each app. Only notifications carrying an orderId (order/delivery
    // related) get a destination — payment/promo notifications with no
    // orderId leave `screen` undefined and the client just opens the app
    // without navigating, same as today.
    let screen: string | undefined;
    let screenParams: Record<string, string> | undefined;
    if (payload.orderId) {
      if (user.role === "vendor") {
        screen = "/authenticated/vendor/transactions/orders/[id]/orderdetails";
      } else if (user.role === "rider") {
        screen = "/authenticated/deliveries/[id]/details";
      } else {
        screen = "/authenticated/user/transactions/orders/[id]/details";
      }
      screenParams = { id: payload.orderId };
    }

    sendPush({
      token: user.pushToken,
      title: payload.title,
      body: payload.message,
      sound: pushSound,
      channelId,
      data: {
        notificationId: notification.id,
        type: payload.type,
        subType: payload.subType,
        orderId: payload.orderId,
        screen,
        params: screenParams,
      },
    }).catch((err) => logger.error("[push] delivery failed", err));
  } catch (err) {
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
    category: "orderConfirmation",
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
    category: "orderStatusUpdates",
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
    category: "orderStatusUpdates",
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
    category: "deliveryArrivals",
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
  // No category — cancellations are always delivered (financial/refund impact).
  push({
    userId,
    type: "order",
    subType: "general",
    title:
      cancelledBy === "store" ? "Order Cancelled by Store" : "Order Cancelled",
    message:
      cancelledBy === "store"
        ? "The store cancelled your order. A refund request has been submitted and will be reviewed."
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
    category: "newOrders",
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
    category: "orderStatusUpdates",
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
  // No category — financial confirmations are always delivered.
  push({
    userId,
    type: "payment",
    subType: "general",
    title: "Refund Processed ✅",
    message: `₦${amount.toLocaleString()} has been refunded to your original payment method.`,
    icon: "cash-outline",
    iconBg: "#34C759",
  });

// ─────────────────────────────────────────────────────────────────────────────
// Referral events
// ─────────────────────────────────────────────────────────────────────────────

export const notifyRefundDenied = (
  userId: string,
  reason?: string,
): Promise<void> =>
  // No category — financial resolutions are always delivered.
  push({
    userId,
    type: "payment",
    subType: "general",
    title: "Refund Request Declined",
    message: reason
      ? `Your refund request was declined. Reason: ${reason}`
      : "Your refund request was declined.",
    icon: "close-circle-outline",
    iconBg: "#FF3B30",
  });

export const notifyPaymentFailed = (userId: string): Promise<void> =>
  // No category — payment failures are always delivered.
  push({
    userId,
    type: "payment",
    subType: "general",
    title: "Payment Failed",
    message: "Your payment could not be processed. Please try again.",
    icon: "close-circle-outline",
    iconBg: "#FF3B30",
  });

export const notifyReferralBonus = (
  userId: string,
  bonusAmount: number,
  refereeName: string,
): Promise<void> =>
  // No category — financial confirmations are always delivered.
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
    category: "orderStatusUpdates",
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
    category: "promos",
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
    category: "riderArrival",
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
      // Gated by the rider's "Available Orders" toggle. A rider who turned
      // this off still gets the in-app record but no push, matching the
      // setting they chose on the rider notifications screen.
      push({
        userId,
        type: "order",
        subType: "general",
        category: "newOrders",
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
  // Gated by the rider's "Order Updates" toggle — confirmation that the
  // rider's own accepted job is ready to pick up is an order update.
  push({
    userId,
    type: "order",
    subType: "general",
    category: "orderStatusUpdates",
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
  // No category — financial confirmations are always delivered.
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

export const notifyVendorWithdrawalCompleted = (
  userId: string,
  amount: number,
): Promise<void> =>
  // No category — financial confirmations are always delivered.
  push({
    userId,
    type: "payment",
    subType: "general",
    title: "Withdrawal Successful ✅",
    message: `₦${Math.round(amount).toLocaleString()} has been sent to your bank account.`,
    icon: "cash-outline",
    iconBg: "#34C759",
    price: amount,
  });

export const notifyVendorWithdrawalFailed = (
  userId: string,
  amount: number,
  reason: string,
): Promise<void> =>
  push({
    userId,
    type: "payment",
    subType: "general",
    title: "Withdrawal Failed",
    message: `Your withdrawal of ₦${Math.round(amount).toLocaleString()} could not be completed: ${reason}`,
    icon: "close-circle-outline",
    iconBg: "#FF3B30",
    price: amount,
  });

export const notifyRiderWithdrawalCompleted = (
  userId: string,
  amount: number,
): Promise<void> =>
  push({
    userId,
    type: "payment",
    subType: "general",
    title: "Withdrawal Successful ✅",
    message: `₦${Math.round(amount).toLocaleString()} has been sent to your bank account.`,
    icon: "cash-outline",
    iconBg: "#34C759",
    price: amount,
  });

export const notifyRiderWithdrawalFailed = (
  userId: string,
  amount: number,
  reason: string,
): Promise<void> =>
  push({
    userId,
    type: "payment",
    subType: "general",
    title: "Withdrawal Failed",
    message: `Your withdrawal of ₦${Math.round(amount).toLocaleString()} could not be completed: ${reason}`,
    icon: "close-circle-outline",
    iconBg: "#FF3B30",
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
    category: "reviews",
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
    category: "riderArrival",
    title: "Rider has arrived 🛵",
    message: `${riderName} is at your store to pick up the order.`,
    icon: "bicycle-outline",
    iconBg: "#007AFF",
    orderId,
  });

export const notifyCustomerRiderArrived = (
  customerUserId: string,
  orderId: string,
  riderName: string,
): Promise<void> =>
  push({
    userId: customerUserId,
    type: "rider",
    subType: "approaching",
    category: "riderArrival",
    title: "Your rider has arrived 🛵",
    message: `${riderName} is here with your order.`,
    icon: "bicycle-outline",
    iconBg: "#007AFF",
    orderId,
  });

export const notifyVendorReviewUpdated = (
  vendorUserId: string,
  rating: number,
): Promise<void> =>
  push({
    userId: vendorUserId,
    type: "order",
    subType: "general",
    category: "reviews",
    title: "A review was updated ⭐",
    message: `A customer updated their review to ${rating} stars.`,
    icon: "star-outline",
    iconBg: "#FF9F0A",
  });

export const notifyVendorReviewRemoved = (
  vendorUserId: string,
): Promise<void> =>
  push({
    userId: vendorUserId,
    type: "order",
    subType: "general",
    category: "reviews",
    title: "A review was removed",
    message: "A customer removed their review.",
    icon: "star-outline",
    iconBg: "#FF9F0A",
  });

// ─────────────────────────────────────────────────────────────────────────────
// Support issue events
// ─────────────────────────────────────────────────────────────────────────────

export const notifyIssueUpdated = (
  userId: string,
  status: "IN_REVIEW" | "RESOLVED",
  adminResponse?: string | null,
): Promise<void> =>
  // No category — support responses are always delivered.
  push({
    userId,
    type: "account",
    subType: "general",
    title:
      status === "RESOLVED"
        ? "Your support ticket was resolved"
        : "Your support ticket has an update",
    message:
      adminResponse ??
      (status === "RESOLVED"
        ? "Your reported issue has been marked resolved."
        : "An admin is reviewing your reported issue."),
    icon: "chatbubble-ellipses-outline",
    iconBg: "#007AFF",
  });

// ─────────────────────────────────────────────────────────────────────────────
// Promotion events (admin-authored, vendor-facing)
// ─────────────────────────────────────────────────────────────────────────────

export const notifyVendorPromotionCreated = (
  vendorUserId: string,
  title: string,
): Promise<void> =>
  push({
    userId: vendorUserId,
    type: "promo",
    subType: "general",
    category: "promos",
    title: "New promotion added",
    message: `An admin created the promotion "${title}" for your store.`,
    icon: "pricetag-outline",
    iconBg: "#7F56D9",
  });

export const notifyVendorPromotionUpdated = (
  vendorUserId: string,
  title: string,
): Promise<void> =>
  push({
    userId: vendorUserId,
    type: "promo",
    subType: "general",
    category: "promos",
    title: "Promotion updated",
    message: `An admin updated the promotion "${title}" on your store.`,
    icon: "pricetag-outline",
    iconBg: "#7F56D9",
  });

export const notifyVendorPromotionDeactivated = (
  vendorUserId: string,
  title: string,
): Promise<void> =>
  push({
    userId: vendorUserId,
    type: "promo",
    subType: "general",
    category: "promos",
    title: "Promotion deactivated",
    message: `An admin deactivated the promotion "${title}" on your store.`,
    icon: "pricetag-outline",
    iconBg: "#FF9F0A",
  });

export const notifyVendorPromotionDeleted = (
  vendorUserId: string,
  title: string,
): Promise<void> =>
  push({
    userId: vendorUserId,
    type: "promo",
    subType: "general",
    category: "promos",
    title: "Promotion removed",
    message: `An admin removed the promotion "${title}" from your store.`,
    icon: "pricetag-outline",
    iconBg: "#FF3B30",
  });

// ─────────────────────────────────────────────────────────────────────────────
// Admin notifications
// ─────────────────────────────────────────────────────────────────────────────
//
// Admins are ordinary User rows (via AdminProfile.userId) so they reuse the
// same push() pipeline. No `category` is ever set on these — NotificationSettings
// has no admin-specific toggles, so nothing to gate. `orderId` is deliberately
// omitted — the deep-link `screen` resolution above only knows the user/vendor/
// rider app routes, not the separate rave-admin web app.
const notifyAdmins = async (
  roles: AdminRole[],
  payload: Omit<NotificationPayload, "userId">,
): Promise<void> => {
  const admins = await prisma.adminProfile.findMany({
    where: {
      isActive: true,
      adminRole: { in: [...new Set([...roles, "super_admin" as AdminRole])] },
    },
    select: { userId: true },
  });
  await Promise.all(admins.map((a) => push({ ...payload, userId: a.userId })));
};

export const notifyAdminsNewRefundRequest = (
  amount: number,
): Promise<void> =>
  notifyAdmins(["finance"], {
    type: "payment",
    subType: "general",
    title: "New refund request",
    message: `A refund request for ₦${Math.round(amount).toLocaleString()} needs review.`,
    icon: "cash-outline",
    iconBg: "#FF9F0A",
  });

export const notifyAdminsNewIssue = (category: string): Promise<void> =>
  notifyAdmins(["support"], {
    type: "account",
    subType: "general",
    title: "New support ticket",
    message: `A new ${category} issue was submitted.`,
    icon: "help-circle-outline",
    iconBg: "#FF9F0A",
  });

export const notifyAdminsVendorSubmittedOnboarding = (
  storeName: string,
): Promise<void> =>
  notifyAdmins(["ops"], {
    type: "account",
    subType: "general",
    title: "Vendor pending review",
    message: `${storeName} submitted their store for approval.`,
    icon: "storefront-outline",
    iconBg: "#007AFF",
  });

export const notifyAdminsRiderSubmittedDocuments = (): Promise<void> =>
  notifyAdmins(["ops"], {
    type: "account",
    subType: "general",
    title: "Rider pending verification",
    message: "A rider submitted documents for verification.",
    icon: "bicycle-outline",
    iconBg: "#007AFF",
  });

// ─────────────────────────────────────────────────────────────────────────────
// Admin — account status events
// ─────────────────────────────────────────────────────────────────────────────

const VENDOR_STATUS_COPY: Record<string, { title: string; message: string; icon: string; iconBg: string }> = {
  open: {
    title: "Your store is approved! 🎉",
    message: "Your store has been approved and is now visible to customers.",
    icon: "checkmark-circle-outline",
    iconBg: "#34C759",
  },
  denied: {
    title: "Store application declined",
    message: "Your store application wasn't approved. Check your store status for details.",
    icon: "close-circle-outline",
    iconBg: "#FF3B30",
  },
  deactivated: {
    title: "Your store has been suspended",
    message: "Your store has been suspended by the Rave team. Check your store status for details.",
    icon: "alert-circle-outline",
    iconBg: "#FF3B30",
  },
};

// No category — account-status changes are always delivered, the vendor can't opt out.
export const notifyVendorStatusChanged = (
  vendorUserId: string,
  status: "open" | "denied" | "deactivated",
  reason?: string,
): Promise<void> => {
  const copy = VENDOR_STATUS_COPY[status];
  return push({
    userId: vendorUserId,
    type: "account",
    subType: "general",
    title: copy.title,
    message: reason ? `${copy.message} Reason: ${reason}` : copy.message,
    icon: copy.icon,
    iconBg: copy.iconBg,
  });
};

const RIDER_STATUS_COPY: Record<string, { title: string; message: string; icon: string; iconBg: string }> = {
  verified: {
    title: "You're verified! 🎉",
    message: "Your documents have been verified. You can now go online and start accepting deliveries.",
    icon: "checkmark-circle-outline",
    iconBg: "#34C759",
  },
  suspended: {
    title: "Your account has been suspended",
    message: "Your rider account has been suspended by the Rave team.",
    icon: "alert-circle-outline",
    iconBg: "#FF3B30",
  },
  not_verified: {
    title: "Document verification needed",
    message: "One of your submitted documents was rejected and needs to be resubmitted.",
    icon: "alert-circle-outline",
    iconBg: "#FF9F0A",
  },
};

export const notifyRiderStatusChanged = (
  riderUserId: string,
  status: "verified" | "suspended" | "not_verified",
  reason?: string,
): Promise<void> => {
  const copy = RIDER_STATUS_COPY[status];
  return push({
    userId: riderUserId,
    type: "account",
    subType: "general",
    title: copy.title,
    message: reason ? `${copy.message} Reason: ${reason}` : copy.message,
    icon: copy.icon,
    iconBg: copy.iconBg,
  });
};
