// src/routes/review.routes.ts
import { Router } from "express";
import * as ctrl from "../controllers/review.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import * as v from "../validators";

const router = Router();

// Any authenticated role (user, vendor, rider) can report a review they can see.
router.post(
  "/:id/report",
  authenticate,
  validate(v.reportReviewSchema),
  ctrl.reportReview,
);

export default router;
