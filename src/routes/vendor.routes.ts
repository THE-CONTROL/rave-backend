// src/routes/vendor.routes.ts
import { Router } from "express";
import * as ctrl from "../controllers/vendor.controller";
import * as evidenceCtrl from "../controllers/evidence.controller";
import * as paymentCtrl from "../controllers/payment.controller";
import * as orderCtrl from "../controllers/order.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import * as v from "../validators";

const router = Router();

router.use(authenticate, authorize("vendor"));

// ── Profile ──────────────────────────────────────────────────────────────────
router.get("/profile", ctrl.getProfile);
router.patch("/profile", validate(v.updateProfileSchema), ctrl.updateProfile);
router.patch(
  "/password",
  validate(v.changePasswordSchema),
  ctrl.changePassword,
);
router.delete("/account", ctrl.deleteAccount);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/dashboard", ctrl.getDashboard);
// ── Onboarding ────────────────────────────────────────────────────────────────
router.get("/onboarding", ctrl.getVendorOnboardingState);
router.patch("/onboarding/:step", ctrl.saveVendorOnboardingStep);
router.post("/onboarding/submit", ctrl.submitVendorOnboarding);

// ── Store Settings ────────────────────────────────────────────────────────────
router.get("/store", ctrl.getStoreSettings);
router.patch("/store", validate(v.updateStoreSchema), ctrl.updateStoreSettings);
router.patch("/store/toggle", ctrl.toggleStoreOpen);
router.get("/store/schedules", ctrl.getStoreSchedules);
router.put(
  "/store/schedules",
  validate(v.storeScheduleSchema),
  ctrl.upsertStoreSchedules,
);

// ── Categories ────────────────────────────────────────────────────────────────
router.get("/categories", ctrl.getCategories);
router.get("/categories/:id", ctrl.getCategoryById);
router.post(
  "/categories",
  validate(v.createCategorySchema),
  ctrl.createCategory,
);
router.patch(
  "/categories/:id",
  validate(v.updateCategorySchema),
  ctrl.updateCategory,
);
router.delete(
  "/categories",
  validate(v.deleteBatchSchema),
  ctrl.deleteCategories,
);
router.post(
  "/categories/:id/items",
  validate(v.addItemsToCategorySchema),
  ctrl.addItemsToCategory,
);

// ── Menu Items ────────────────────────────────────────────────────────────────
router.get("/menu", ctrl.getMenuItems);
router.get("/menu/:id", ctrl.getMenuItemById);
router.post("/menu", validate(v.createMenuItemSchema), ctrl.createMenuItem);
router.patch(
  "/menu/:id",
  validate(v.updateMenuItemSchema),
  ctrl.updateMenuItem,
);
router.delete("/menu", validate(v.deleteBatchSchema), ctrl.deleteMenuItems);

// ── Orders ────────────────────────────────────────────────────────────────────
router.get("/orders", ctrl.getOrders);
router.get("/orders/:id", ctrl.getOrderById);
router.patch(
  "/orders/:id/status",
  validate(v.updateOrderStatusSchema),
  orderCtrl.advanceStatus,
);
router.patch(
  "/:id/evidence",
  validate(v.uploadEvidenceSchema), // Validates that evidenceUrl is a valid URL
  orderCtrl.uploadOrderEvidence,
);

// ── Analytics ─────────────────────────────────────────────────────────────────
router.get("/analytics", ctrl.getAnalytics);

// ── Earnings / Transactions ───────────────────────────────────────────────────
router.get("/transactions", ctrl.getTransactions);
router.get("/transactions/:id", ctrl.getTransactionById);

// ── Bank Accounts ─────────────────────────────────────────────────────────────
router.get("/banks", ctrl.getBankAccounts);
router.post("/banks", validate(v.saveBankSchema), ctrl.saveBankAccount);
router.patch("/banks/:id/primary", ctrl.setPrimaryBank);
router.delete("/banks/:id", ctrl.deleteBankAccount);

// ── Promotions ────────────────────────────────────────────────────────────────
router.get("/promotions", ctrl.getPromotions);
router.get("/promotions/:id", ctrl.getPromotionById);
router.post(
  "/promotions",
  validate(v.createPromotionSchema),
  ctrl.createPromotion,
);
router.patch(
  "/promotions/:id",
  validate(v.updatePromotionSchema),
  ctrl.updatePromotion,
);
router.delete("/promotions/:id", ctrl.deletePromotion);

// ── Reviews ───────────────────────────────────────────────────────────────────
router.get("/reviews", ctrl.getReviews);
router.get("/reviews/stats", ctrl.getRatingStats);

// ── Badges ────────────────────────────────────────────────────────────────────
router.get("/badges", ctrl.getBadges);
router.get("/badges/stats", ctrl.getBadgeStats);
router.get("/badges/:id", ctrl.getBadgeById);

// ── Referrals ─────────────────────────────────────────────────────────────────
router.get("/referrals", ctrl.getReferralStats);

// ── Notifications ─────────────────────────────────────────────────────────────
router.get("/notifications", ctrl.getNotifications);
router.patch("/notifications/read-all", ctrl.markAllNotificationsRead);
router.delete("/notifications/:id", ctrl.deleteNotification);
router.get("/notifications/settings", ctrl.getNotificationSettings);
router.patch("/notifications/settings", ctrl.updateNotificationSettings);

// ── Evidence upload ───────────────────────────────────────────────────────────
router.post("/orders/:id/evidence", evidenceCtrl.uploadEvidence);

router.patch("/push-token", ctrl.updatePushToken);

router.get("/orders/:id/rider-location", ctrl.getRiderLocation);

export default router;
