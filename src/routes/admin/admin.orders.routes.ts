// src/routes/admin/admin.orders.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/orderAdmin.controller";

const router = Router();

router.get("/", ctrl.listOrders);
// Must precede "/:id" — otherwise "pending" would be captured as an :id param.
router.get("/pending", ctrl.listPendingOrders);
router.get("/:id", ctrl.getOrderDetail);

export default router;
