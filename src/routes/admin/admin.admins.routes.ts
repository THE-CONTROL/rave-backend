// src/routes/admin/admin.admins.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/adminAuth.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";
import { validate } from "../../middleware/validate";
import { createAdminSchema, updateAdminSchema } from "../../validators";

const router = Router();

router.use(requireAdminRole("super_admin"));

router.get("/", ctrl.listAdmins);
router.post("/", validate(createAdminSchema), ctrl.createAdmin);
router.get("/:id", ctrl.getAdminById);
router.patch("/:id", validate(updateAdminSchema), ctrl.updateAdmin);
router.delete("/:id", ctrl.deactivateAdmin);

export default router;
