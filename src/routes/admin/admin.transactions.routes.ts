// src/routes/admin/admin.transactions.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/transactionAdmin.controller";

const router = Router();

router.get("/", ctrl.listTransactions);
router.get("/:id", ctrl.getTransactionDetail);

export default router;
