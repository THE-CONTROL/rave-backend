// src/routes/admin/admin.feedback.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/feedbackAdmin.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";

const router = Router();

router.use(requireAdminRole("super_admin", "support"));

router.get("/", ctrl.listFeedback);

export default router;
