// src/routes/admin/admin.ads.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/ads.controller";
import { validate } from "../../middleware/validate";
import { createAdSchema, updateAdSchema } from "../../validators";

const router = Router();

router.get("/", ctrl.listAds);
router.post("/", validate(createAdSchema), ctrl.createAd);
router.get("/:id", ctrl.getAdById);
router.patch("/:id", validate(updateAdSchema), ctrl.updateAd);
router.delete("/:id", ctrl.deleteAd);
router.get("/:id/stats", ctrl.getAdStats);

export default router;
