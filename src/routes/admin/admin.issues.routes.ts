// src/routes/admin/admin.issues.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/issueAdmin.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";
import { validate } from "../../middleware/validate";
import { updateIssueStatusSchema, respondToIssueSchema } from "../../validators";

const router = Router();

router.use(requireAdminRole("super_admin", "support"));

router.get("/", ctrl.listIssues);
router.get("/:id", ctrl.getIssueDetail);
router.patch("/:id/status", validate(updateIssueStatusSchema), ctrl.updateIssueStatus);
router.post("/:id/respond", validate(respondToIssueSchema), ctrl.respondToIssue);

export default router;
