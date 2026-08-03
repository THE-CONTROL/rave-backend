// src/routes/admin/admin.bankaccounts.routes.ts
import { Router } from "express";
import * as ctrl from "../../controllers/admin/bankAccountAdmin.controller";
import { requireAdminRole } from "../../middleware/requireAdminRole";

const router = Router();

// Bank account PII is sensitive — restrict to finance, tighter than the
// general ops-visibility tier used for orders/transactions/deliveries.
router.use(requireAdminRole("super_admin", "finance"));

router.get("/", ctrl.listBankAccounts);

export default router;
