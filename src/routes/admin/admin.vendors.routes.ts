// src/routes/admin/admin.vendors.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/vendorAdmin.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";
import { validate } from "../../middleware/validate";
import { denyVendorSchema, suspendVendorSchema } from "../../validators";

const router = Router();

router.use(requireAdminRole("super_admin", "ops"));

router.get("/", ctrl.listVendors);
router.get("/:id", ctrl.getVendorDetail);
router.post("/:id/approve", ctrl.approveVendor);
router.post("/:id/deny", validate(denyVendorSchema), ctrl.denyVendor);
router.post("/:id/suspend", validate(suspendVendorSchema), ctrl.suspendVendor);
router.post("/:id/reactivate", ctrl.reactivateVendor);

export default router;
