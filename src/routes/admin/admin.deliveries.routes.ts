// src/routes/admin/admin.deliveries.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/deliveryAdmin.controller";

const router = Router();

router.get("/", ctrl.listDeliveries);
router.get("/:id", ctrl.getDeliveryDetail);

export default router;
