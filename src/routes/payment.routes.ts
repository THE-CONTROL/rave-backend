// src/routes/payment.routes.ts
import { Router } from "express";
import * as ctrl from "../controllers/payment.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

// Webhook — no auth, Paystack posts here directly
router.post("/webhook", ctrl.webhook);

// Public — needed before login (card merchant detection, bank list)
router.get("/banks", ctrl.listBanks);
router.get("/resolve-account", ctrl.resolveAccount);

// Callback — Paystack redirects the user's browser here after payment
router.get("/callback", ctrl.handleCallback);

// Everything below requires auth
router.use(authenticate);

export default router;
