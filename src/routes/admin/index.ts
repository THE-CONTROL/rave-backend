// src/routes/admin/index.ts
import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import adminsRoutes from "./admin.admins.routes";
import meRoutes from "./admin.me.routes";
import configRoutes from "./admin.config.routes";
import adsRoutes from "./admin.ads.routes";
import onboardingRoutes from "./admin.onboarding.routes";
import vendorsRoutes from "./admin.vendors.routes";
import ridersRoutes from "./admin.riders.routes";
import ordersRoutes from "./admin.orders.routes";
import transactionsRoutes from "./admin.transactions.routes";
import deliveriesRoutes from "./admin.deliveries.routes";
import usersRoutes from "./admin.users.routes";
import issuesRoutes from "./admin.issues.routes";
import reviewsRoutes from "./admin.reviews.routes";
import refundsRoutes from "./admin.refunds.routes";
import contentRoutes from "./admin.content.routes";
import analyticsRoutes from "./admin.analytics.routes";
import auditRoutes from "./admin.audit.routes";
import catalogRoutes from "./admin.catalog.routes";
import promotionsRoutes from "./admin.promotions.routes";
import feedbackRoutes from "./admin.feedback.routes";
import referralsRoutes from "./admin.referrals.routes";
import bankAccountsRoutes from "./admin.bankaccounts.routes";
import emailRoutes from "./admin.email.routes";
import { requireAdminRole } from "../../middleware/requireAdminRole";

const router = Router();

// Every /admin route requires a valid JWT for an account with Role "admin".
// Finer-grained AdminRole permission checks (super_admin/support/ops/finance/
// content) are layered per-sub-router via requireAdminRole.
router.use(authenticate, authorize("admin"));

router.use("/me", meRoutes);
router.use("/admins", adminsRoutes);
router.use("/config", configRoutes);
router.use("/ads", adsRoutes);
router.use("/onboarding-slides", onboardingRoutes);
router.use("/vendors", vendorsRoutes);
router.use("/riders", ridersRoutes);

// Cross-tenant, read-only operational data browsing — every non-content admin
// role needs this tier of visibility to do their job (support/finance/ops).
const opsVisibility = requireAdminRole("super_admin", "support", "finance", "ops");
router.use("/orders", opsVisibility, ordersRoutes);
router.use("/transactions", opsVisibility, transactionsRoutes);
router.use("/deliveries", opsVisibility, deliveriesRoutes);

router.use("/users", usersRoutes);
router.use("/issues", issuesRoutes);
// admin.reviews.routes.ts defines its own full paths ("/review-reports",
// "/reviews/:id/remove") to match the plan's route shape, so it's mounted at
// the admin root rather than under a "/reviews" prefix.
router.use(reviewsRoutes);
router.use("/refunds", refundsRoutes);

// admin.content.routes.ts defines its own full paths ("/legal-documents",
// "/help-categories", "/categories", "/badges") to match the plan's route
// shape, so it's mounted at the admin root rather than under a shared prefix.
router.use(contentRoutes);

// admin.catalog.routes.ts defines its own full paths ("/menu-items",
// "/option-groups") to match the plan's route shape, so it's mounted at the
// admin root rather than under a shared prefix.
router.use(catalogRoutes);
router.use("/promotions", promotionsRoutes);
router.use("/feedback", feedbackRoutes);
router.use("/referrals", referralsRoutes);
router.use("/bank-accounts", bankAccountsRoutes);
router.use("/email", emailRoutes);

router.use("/analytics", analyticsRoutes);
router.use("/audit-logs", auditRoutes);

export default router;
