// src/routes/user.routes.ts
import { Router } from "express";
import * as ctrl from "../controllers/user.controller";
import * as orderCtrl from "../controllers/order.controller";
import * as reviewCtrl from "../controllers/myReviews.controller";
import * as walletCtrl from "../controllers/wallet.controller";
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
router.patch("/push-token", ctrl.updatePushToken);

// ── Addresses ─────────────────────────────────────────────────────────────────
router.get("/addresses", ctrl.getAddresses);
router.get("/addresses/:id", ctrl.getAddressById);
router.post("/addresses", validate(v.addAddressSchema), ctrl.addAddress);
router.patch(
  "/addresses/:id",
  validate(v.updateAddressSchema),
  ctrl.updateAddress,
);
router.patch("/addresses/:id/default", ctrl.setDefaultAddress);
router.delete("/addresses/:id", ctrl.deleteAddress);

// ── Saved Locations ───────────────────────────────────────────────────────────
router.get("/locations", ctrl.getSavedLocations);
router.post("/locations", validate(v.locationSchema), ctrl.upsertLocation);
router.put("/locations/:id", validate(v.locationSchema), ctrl.upsertLocation);
router.delete("/locations/:id", ctrl.deleteLocation);

// ── Wallet ────────────────────────────────────────────────────────────────────
router.get("/wallet", ctrl.getWallet);
router.get("/wallet/topup-methods", walletCtrl.getTopUpMethods);
router.get("/wallet/transfer-details", walletCtrl.getVirtualAccount);
router.post("/wallet/topup", validate(v.topUpSchema), ctrl.topUpWallet);
router.post(
  "/wallet/withdraw",
  validate(v.withdrawalSchema),
  ctrl.requestWithdrawal,
);

// ── Cards ─────────────────────────────────────────────────────────────────────
router.get("/wallet/cards", ctrl.getSavedCards);
router.delete("/wallet/cards/:id", ctrl.deleteCard);
router.patch("/wallet/cards/:id/default", ctrl.setDefaultCard);

// ── Banks ─────────────────────────────────────────────────────────────────────
router.get("/wallet/banks", ctrl.getSavedBanks);
router.post("/wallet/banks", validate(v.addBankSchema), ctrl.addBankAccount);
router.get("/wallet/banks/:id", ctrl.getBankAccountById);
router.patch("/wallet/banks/:id", ctrl.updateBankAccount);
router.patch("/wallet/banks/:id/default", ctrl.setDefaultBank);
router.delete("/wallet/banks/:id", ctrl.deleteBankAccount);

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
router.post("/cart/promo", ctrl.previewPromo);
router.post("/cart/checkout", validate(v.checkoutSchema), ctrl.processCheckout);

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
