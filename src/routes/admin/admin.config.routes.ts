// src/routes/admin/admin.config.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/config.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";
import { validate } from "../../middleware/validate";
import { updateConfigSchema } from "../../validators";

const router = Router();

router.get("/", ctrl.listConfigs);
router.patch(
  "/:key",
  requireAdminRole("super_admin", "finance", "ops"),
  validate(updateConfigSchema),
  ctrl.updateConfig,
);

export default router;
