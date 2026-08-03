// src/routes/admin/admin.referrals.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/referralAdmin.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";

const router = Router();

router.use(requireAdminRole("super_admin", "finance"));

router.get("/", ctrl.listReferrals);

export default router;
