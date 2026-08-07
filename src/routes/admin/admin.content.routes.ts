// src/routes/admin/admin.content.routes.ts
//
// "Policy & content" admin surface: legal documents, help center, categories,
// badges. Grouped into one router (mounted at the admin root) since each
// sub-area needs its own distinct URL prefix rather than nesting under a
// shared "/content" path.
import { Router } from "express";
import * as legalCtrl from "../../controllers/admin/legal.controller";
import * as helpCtrl from "../../controllers/admin/helpCenter.controller";
import * as badgesCtrl from "../../controllers/admin/badges.controller";
import * as categoryCtrl from "../../controllers/admin/categoryAdmin.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";
import { validate } from "../../middleware/validate";
import {
  createLegalDocSchema,
  publishLegalDocVersionSchema,
  createHelpCategorySchema,
  updateHelpCategorySchema,
  createHelpArticleSchema,
  updateHelpArticleSchema,
  createBadgeSchema,
  updateBadgeSchema,
  createBadgeRequirementSchema,
  updateBadgeRequirementSchema,
  toggleCategoryActiveSchema,
} from "../../validators";

const router = Router();

router.use(requireAdminRole("super_admin", "content"));

// ── Legal documents ──
router.get("/legal-documents", legalCtrl.listLegalDocs);
router.get("/legal-documents/:slug/:role/history", legalCtrl.getVersionHistory);
router.post("/legal-documents", validate(createLegalDocSchema), legalCtrl.createLegalDoc);
router.put(
  "/legal-documents/:slug/:role",
  validate(publishLegalDocVersionSchema),
  legalCtrl.publishNewVersion,
);
router.delete("/legal-documents/:id", legalCtrl.deleteLegalDoc);

// ── Help center ──
router.get("/help-categories", helpCtrl.listHelpCategories);
router.post("/help-categories", validate(createHelpCategorySchema), helpCtrl.createHelpCategory);
router.get("/help-categories/:id", helpCtrl.getHelpCategoryById);
router.patch(
  "/help-categories/:id",
  validate(updateHelpCategorySchema),
  helpCtrl.updateHelpCategory,
);
router.delete("/help-categories/:id", helpCtrl.deleteHelpCategory);

router.get("/help-articles", helpCtrl.listHelpArticles);
router.post("/help-articles", validate(createHelpArticleSchema), helpCtrl.createHelpArticle);
router.get("/help-articles/:id", helpCtrl.getHelpArticleById);
router.patch(
  "/help-articles/:id",
  validate(updateHelpArticleSchema),
  helpCtrl.updateHelpArticle,
);
router.delete("/help-articles/:id", helpCtrl.deleteHelpArticle);

// ── Categories (list/moderate only) ──
router.get("/categories", categoryCtrl.listAllCategories);
router.patch(
  "/categories/:id/active",
  validate(toggleCategoryActiveSchema),
  categoryCtrl.toggleCategoryActive,
);

// ── Badges ──
router.get("/badges", badgesCtrl.listBadges);
router.post("/badges", validate(createBadgeSchema), badgesCtrl.createBadge);
router.get("/badges/:id", badgesCtrl.getBadgeById);
router.get("/badges/:id/vendors", badgesCtrl.getBadgeVendors);
router.patch("/badges/:id", validate(updateBadgeSchema), badgesCtrl.updateBadge);
router.delete("/badges/:id", badgesCtrl.deleteBadge);
router.post(
  "/badges/:id/requirements",
  validate(createBadgeRequirementSchema),
  badgesCtrl.addRequirement,
);
router.patch(
  "/badges/:id/requirements/:reqId",
  validate(updateBadgeRequirementSchema),
  badgesCtrl.updateRequirement,
);
router.delete("/badges/:id/requirements/:reqId", badgesCtrl.deleteRequirement);

export default router;
