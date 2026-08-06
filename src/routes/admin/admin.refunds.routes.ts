// src/routes/admin/admin.refunds.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/refundAdmin.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";
import { validate } from "../../middleware/validate";
import { adminDeclineRefundSchema } from "../../validators";

const router = Router();

router.use(requireAdminRole("super_admin", "finance"));

router.get("/", ctrl.listAllRefunds);
router.get("/:id", ctrl.getRefundDetail);
router.post("/:id/approve", ctrl.forceApproveRefund);
router.post("/:id/decline", validate(adminDeclineRefundSchema), ctrl.forceDeclineRefund);

export default router;
