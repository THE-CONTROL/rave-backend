// src/routes/admin/admin.reviews.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/reviewAdmin.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";
import { validate } from "../../middleware/validate";
import { removeReviewSchema } from "../../validators";

const router = Router();

router.use(requireAdminRole("super_admin", "support"));

router.get("/review-reports", ctrl.listReviewReports);
router.post("/review-reports/:id/dismiss", ctrl.dismissReport);
router.post("/reviews/:id/remove", validate(removeReviewSchema), ctrl.removeReview);

export default router;
