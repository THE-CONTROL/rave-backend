// src/routes/optionGroup.routes.ts
import { Router } from "express";
import * as ctrl from "../controllers/optionGroup.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

router.use(authenticate, authorize("rider"));

router.get("/", ctrl.getOptionGroups);
router.get("/:id", ctrl.getOptionGroupById);
router.post("/", ctrl.createOptionGroup);
router.patch("/:id", ctrl.updateOptionGroup);
router.delete("/:id", ctrl.deleteOptionGroup);

export default router;
