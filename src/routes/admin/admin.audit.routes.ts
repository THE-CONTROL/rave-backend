// src/routes/admin/admin.audit.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/audit.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";

const router = Router();

// Audit trail visibility is itself a sensitive surface — super_admin only.
router.use(requireAdminRole("super_admin"));

router.get("/", ctrl.getAuditLogs);

export default router;
