// src/routes/admin/admin.catalog.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/catalogAdmin.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";

const router = Router();

router.use(requireAdminRole("super_admin", "ops", "content"));

router.get("/menu-items", ctrl.listMenuItems);
router.get("/menu-items/:id", ctrl.getMenuItemDetail);
router.get("/option-groups", ctrl.listOptionGroups);

export default router;
