// src/routes/admin/admin.promotions.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/promotionAdmin.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";
import { validate } from "../../middleware/validate";
import { adminCreatePromotionSchema, adminUpdatePromotionSchema } from "../../validators";

const router = Router();

router.use(requireAdminRole("super_admin", "ops", "finance"));

router.get("/", ctrl.listAllPromotions);
router.post("/", validate(adminCreatePromotionSchema), ctrl.createPromotion);
router.get("/:id", ctrl.getPromotionDetail);
router.patch("/:id", validate(adminUpdatePromotionSchema), ctrl.updatePromotion);
router.delete("/:id", ctrl.deletePromotion);
router.post("/:id/deactivate", ctrl.deactivatePromotion);

export default router;
