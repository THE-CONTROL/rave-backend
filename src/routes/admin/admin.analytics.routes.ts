// src/routes/admin/admin.analytics.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/analytics.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";

const router = Router();

router.use(requireAdminRole("super_admin", "finance", "ops"));

router.get("/overview", ctrl.getOverview);
router.get("/growth", ctrl.getGrowth);
router.get("/orders", ctrl.getOrderAnalytics);
router.get("/revenue", ctrl.getRevenueAnalytics);
router.get("/vendors/top", ctrl.getTopVendors);
router.get("/riders/top", ctrl.getTopRiders);
router.get("/engagement", ctrl.getUserEngagement);
router.get("/operations", ctrl.getOperationsSummary);

export default router;
