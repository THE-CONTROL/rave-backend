// src/routes/admin/admin.me.routes.ts
//
// The signed-in admin's own profile — deliberately separate from
// admin.admins.routes.ts (which is super_admin-only for managing *other*
// admin accounts). Every admin, regardless of adminRole, can see their own info.
import { Router } from "express";
import * as ctrl from "../../controllers/admin/adminAuth.controller";

const router = Router();

router.get("/", ctrl.getSelf);

export default router;
