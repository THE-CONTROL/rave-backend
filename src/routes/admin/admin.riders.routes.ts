// src/routes/admin/admin.riders.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/riderAdmin.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";
import { validate } from "../../middleware/validate";
import { rejectRiderSchema, suspendRiderSchema } from "../../validators";

const router = Router();

router.use(requireAdminRole("super_admin", "ops"));

router.get("/", ctrl.listRiders);
router.get("/:id", ctrl.getRiderDetail);
router.post("/:id/verify", ctrl.verifyRider);
router.post("/:id/reject", validate(rejectRiderSchema), ctrl.rejectRider);
router.post("/:id/suspend", validate(suspendRiderSchema), ctrl.suspendRider);
router.post("/:id/reactivate", ctrl.reactivateRider);

export default router;
