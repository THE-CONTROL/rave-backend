// src/routes/user.routes.ts
import { Router } from "express";
import * as ctrl from "../controllers/user.controller";
import * as orderCtrl from "../controllers/order.controller";
import * as reviewCtrl from "../controllers/myReviews.controller";
import * as walletCtrl from "../controllers/wallet.controller";
import * as paymentCtrl from "../controllers/payment.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import * as v from "../validators";

const router = Router();

router.use(authenticate, authorize("user"));

// ── Profile ───────────────────────────────────────────────────────────────────
router.get("/profile", ctrl.getProfile);
router.patch("/profile", validate(v.updateProfileSchema), ctrl.updateProfile);
router.patch(
  "/password",
  validate(v.changePasswordSchema),
  ctrl.changePassword,
);
router.delete("/account", ctrl.deleteAccount);
router.patch("/push-token", validate(v.pushTokenSchema), ctrl.updatePushToken);

// ── Saved Locations ───────────────────────────────────────────────────────────
router.get("/locations", ctrl.getSavedLocations);
router.post("/locations", validate(v.locationSchema), ctrl.upsertLocation);
router.put("/locations/:id", validate(v.locationSchema), ctrl.upsertLocation);
router.delete("/locations/:id", ctrl.deleteLocation);

// ── Transactions ──────────────────────────────────────────────────────────────
router.get("/transactions", ctrl.getTransactions);
router.get("/transactions/:id", ctrl.getTransactionById);

// ── Cart ──────────────────────────────────────────────────────────────────────
router.get("/cart", ctrl.getCart);
router.get("/cart/summary", orderCtrl.getCartSummary);
router.get("/cart/checkout-preview", walletCtrl.getCheckoutPreview);
router.post("/cart", validate(v.addToCartSchema), ctrl.addToCart);
router.patch(
  "/cart/:menuItemId",
  validate(v.updateCartItemSchema),
  ctrl.updateCartItem,
);
router.delete("/cart/:menuItemId", ctrl.removeFromCart);
router.delete("/cart", ctrl.clearCart);
router.post(
  "/cart/promo",
  validate(v.cartPromoSchema),
  ctrl.previewPromo,
);
router.delete("/cart/promo", ctrl.removePromo);
// ── Payment ───────────────────────────────────────────────────────────────────
// Initialize Paystack payment — no order created yet
router.post(
  "/payment/initialize",
  validate(v.initializePaymentSchema),
  paymentCtrl.initializePayment,
);

// Paystack callback — called by Paystack after payment (no auth)
// This should be on a public router, not behind authenticate
// router.get("/payment/callback", paymentCtrl.handleCallback);

// ── Orders ────────────────────────────────────────────────────────────────────
// Create order — only called after frontend confirms payment success
router.post("/orders", validate(v.createOrderSchema), ctrl.createOrder);

// ── Orders ────────────────────────────────────────────────────────────────────
router.get("/orders", ctrl.getOrders);
router.get("/orders/:id", ctrl.getOrderById);
router.get("/orders/:id/track", orderCtrl.getTracking);
router.get("/orders/:orderId/review-form", reviewCtrl.getReviewOrderData);
router.patch(
  "/orders/:id/cancel",
  validate(v.cancelOrderSchema),
  orderCtrl.cancelOrder,
);
router.post("/orders/:id/reorder", orderCtrl.reorder);
router.post("/orders/:id/review", validate(v.reviewSchema), ctrl.submitReview);

// ── Refunds ───────────────────────────────────────────────────────────────────
router.get("/refunds", ctrl.getRefunds);
router.get("/refunds/:id", ctrl.getRefundById);
router.post("/refunds", validate(v.refundRequestSchema), ctrl.requestRefund);
router.delete("/refunds/:id", ctrl.deleteRefundRequest);

// ── Referrals ─────────────────────────────────────────────────────────────────
router.get("/referrals", ctrl.getReferralStats);
router.post(
  "/referrals/apply",
  validate(v.applyReferralSchema),
  ctrl.applyReferralCode,
);

// ── Notifications ─────────────────────────────────────────────────────────────
router.get("/notifications", ctrl.getNotifications);
router.patch("/notifications/read-all", ctrl.markAllNotificationsRead);
router.delete("/notifications/:id", ctrl.deleteNotification);
router.get("/notifications/settings", ctrl.getNotificationSettings);
router.patch("/notifications/settings", ctrl.updateNotificationSettings);
router.patch("/notifications/:id/read", ctrl.markNotificationRead);
router.get("/notifications/unread-count", ctrl.getUnreadNotificationCount);

// ── My Reviews ────────────────────────────────────────────────────────────────
router.get("/my-reviews/pending", reviewCtrl.getPending);
router.get("/my-reviews/past", reviewCtrl.getPast);
router.get("/my-reviews/:id", reviewCtrl.getDetail);
router.patch(
  "/my-reviews/:id",
  validate(v.updateReviewSchema),
  reviewCtrl.updateReview,
);
router.delete("/my-reviews/:id", reviewCtrl.deleteReview);

// ── Favorites ─────────────────────────────────────────────────────────────────
router.get("/favorites/restaurants", ctrl.getFavoriteRestaurants);
router.get("/favorites/products", ctrl.getFavoriteProducts);
router.post("/favorites/restaurants/:vendorId", ctrl.toggleFavoriteRestaurant);
router.post("/favorites/products/:menuItemId", ctrl.toggleFavoriteProduct);

// ── Home ──────────────────────────────────────────────────────────────────────
router.get("/home/usual", ctrl.getUsualOrders);

// ── Search ────────────────────────────────────────────────────────────────────
router.get("/search/suggestions", ctrl.getSearchSuggestions);
router.delete("/search/history", ctrl.clearSearchHistory);
// Note: /search is on the catalog router (GET /catalog/search) — not here

router.get("/orders/:id/rider-location", ctrl.getRiderLocation);

export default router;
