// src/routes/admin/admin.onboarding.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/onboarding.controller";
import { validate } from "../../middleware/validate";
import {
  createOnboardingSlideSchema,
  updateOnboardingSlideSchema,
  reorderOnboardingSlidesSchema,
} from "../../validators";

const router = Router();

router.get("/", ctrl.listSlides);
router.post("/", validate(createOnboardingSlideSchema), ctrl.createSlide);
router.put(
  "/reorder",
  validate(reorderOnboardingSlidesSchema),
  ctrl.reorderSlides,
);
router.get("/:id", ctrl.getSlideById);
router.patch("/:id", validate(updateOnboardingSlideSchema), ctrl.updateSlide);
router.delete("/:id", ctrl.deleteSlide);

export default router;
