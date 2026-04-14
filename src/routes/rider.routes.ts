// src/routes/rider.routes.ts
import { Router } from "express";
import * as ctrl from "../controllers/rider.controller";
import * as paymentCtrl from "../controllers/payment.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import * as v from "../validators";

const router = Router();

router.use(authenticate, authorize("rider"));

// ── Profile ───────────────────────────────────────────────────────────────────
router.get("/profile", ctrl.getProfile);
router.patch(
  "/profile",
  validate(v.riderUpdateProfileSchema),
  ctrl.updateProfile,
);
router.patch(
  "/password",
  validate(v.changePasswordSchema),
  ctrl.changePassword,
);
router.delete("/account", ctrl.deleteAccount);
router.patch("/online", validate(v.riderToggleOnlineSchema), ctrl.toggleOnline);

// ── Location ──────────────────────────────────────────────────────────────────
router.patch("/location", validate(v.riderLocationSchema), ctrl.updateLocation);
router.get("/location/saved", ctrl.getSavedLocation);
router.post(
  "/location/save",
  validate(v.riderLocationSchema),
  ctrl.saveLocation,
);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/dashboard", ctrl.getDashboardStats);
router.get("/orders/available", ctrl.getAvailableOrders);
router.post(
  "/orders/accept",
  validate(v.riderAcceptOrderSchema),
  ctrl.acceptOrder,
);

// ── Deliveries ────────────────────────────────────────────────────────────────
router.get("/deliveries/ongoing", ctrl.getOngoingDeliveries);
router.get("/deliveries/past", ctrl.getPastDeliveries);
router.get("/deliveries/:id", ctrl.getDeliveryDetail);
router.patch(
  "/deliveries/:id/status",
  validate(v.riderDeliveryStatusSchema),
  ctrl.updateDeliveryStatus,
);
router.post(
  "/deliveries/:id/verify-vendor-otp",
  validate(v.riderOtpSchema),
  ctrl.verifyVendorOtp,
);
router.post(
  "/deliveries/:id/verify-customer-otp",
  validate(v.riderOtpSchema),
  ctrl.verifyCustomerOtp,
);
router.post("/deliveries/:id/resend-otp", ctrl.resendOtp);
router.post("/deliveries/:id/pickup-proof", ctrl.uploadPickupProof);
router.post("/deliveries/:id/delivery-proof", ctrl.uploadDeliveryProof);
router.post(
  "/deliveries/:id/issue",
  validate(v.riderIssueSchema),
  ctrl.submitIssueReport,
);

// ── Analytics ─────────────────────────────────────────────────────────────────
router.get("/analytics", ctrl.getAnalytics);

// ── Reviews ───────────────────────────────────────────────────────────────────
router.get("/reviews/stats", ctrl.getRatingStats);
router.get("/reviews", ctrl.getReviews);

// ── Earnings / Transactions ───────────────────────────────────────────────────
router.get("/earnings", ctrl.getEarningsSummary);
router.get("/funds", ctrl.getFundsSummary);
router.get("/transactions", ctrl.getTransactions);
router.get("/transactions/:id", ctrl.getTransactionById);
router.post("/payout", validate(v.riderPayoutSchema), ctrl.requestPayout);

// ── Bank Accounts ─────────────────────────────────────────────────────────────
router.get("/banks", ctrl.getBankAccounts);
router.post("/banks", validate(v.riderSaveBankSchema), ctrl.saveBankAccount);
router.patch("/banks/:id/primary", ctrl.setPrimaryBank);
router.delete("/banks/:id", ctrl.deleteBankAccount);
router.get(
  "/banks/resolve",
  validate(v.riderResolveBankSchema, "query"),
  paymentCtrl.resolveAccount,
);

// ── Notifications ─────────────────────────────────────────────────────────────
router.get("/notifications", ctrl.getNotifications);
router.patch("/notifications/read-all", ctrl.markAllNotificationsRead);
router.delete("/notifications/:id", ctrl.deleteNotification);
router.get("/notifications/settings", ctrl.getNotificationSettings);
router.patch(
  "/notifications/settings",
  validate(v.riderNotificationSettingsSchema),
  ctrl.updateNotificationSettings,
);

// ── Onboarding ──
router.get("/onboarding", ctrl.getRiderOnboardingState);
router.patch("/onboarding/:step", ctrl.saveRiderOnboardingStep);
router.post("/onboarding/submit", ctrl.submitRiderOnboarding);

router.get("/location/current/:orderId", ctrl.getRiderCurrentLocation);

export default router;
