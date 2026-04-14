// src/routes/ad.routes.ts
import { Router } from "express";
import * as ctrl from "../controllers/ad.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { trackAdEventSchema } from "../validators";

const router = Router();

router.get("/startup",  authenticate, ctrl.getStartupAd);
router.post("/track",   authenticate, validate(trackAdEventSchema), ctrl.trackAdEvent);

export default router;
