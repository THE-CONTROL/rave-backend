// src/routes/policy.routes.ts
import { Router } from "express";
import * as ctrl from "../controllers/policy.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { submitIssueSchema, submitFeedbackSchema } from "../validators";

const router = Router();

router.use(authenticate);

router.get("/issues", ctrl.getIssues);
router.get("/issues/:id", ctrl.getIssueById);
router.post("/issues", validate(submitIssueSchema), ctrl.submitIssue);
router.post("/feedback", validate(submitFeedbackSchema), ctrl.submitFeedback);
router.get("/refs", ctrl.getRecentRefs); // deduplicated
router.get("/legal/:slug", ctrl.getLegalDocument);
router.get("/help/categories", ctrl.getHelpCategories);
router.get("/help/categories/:id", ctrl.getHelpCategoryById);
router.get("/help/articles/:articleId", ctrl.getHelpArticle);

export default router;
