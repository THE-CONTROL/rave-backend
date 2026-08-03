// src/routes/admin/admin.email.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/emailAdmin.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";
import { validate } from "../../middleware/validate";
import { sendEmailSchema } from "../../validators";

const router = Router();

router.use(requireAdminRole("super_admin", "support", "content"));

router.post("/", validate(sendEmailSchema), ctrl.sendEmail);

export default router;
