// src/routes/admin/admin.users.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/userAdmin.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";
import { validate } from "../../middleware/validate";
import { suspendUserSchema } from "../../validators";

const router = Router();

router.use(requireAdminRole("super_admin", "support", "ops"));

router.get("/", ctrl.listUsers);
router.get("/:id", ctrl.getUserDetail);
router.get("/:id/notifications", ctrl.listUserNotifications);
router.post("/:id/suspend", validate(suspendUserSchema), ctrl.suspendUser);
router.post("/:id/reactivate", ctrl.reactivateUser);
router.delete("/:id", ctrl.softDeleteUser);

export default router;
