// src/routes/payment.routes.ts
import { RequestHandler, Router } from "express";
import * as ctrl from "../controllers/payment.controller";
import { authenticate } from "@/middleware/auth";

const router = Router();

// Webhook — no auth, Paystack posts here directly
router.post("/webhook", ctrl.webhook);

// Public — needed before login (card merchant detection, bank list)
router.get("/banks", ctrl.listBanks);

// Resolves a bank account number to the holder's name — requires auth so it
// can't be used as an anonymous NUBAN-to-name lookup service.
router.get("/resolve-account", authenticate, ctrl.resolveAccount);

// Callback — Paystack redirects the user's browser here after payment
router.get("/callback", ctrl.handleCallback);

router.get("/status/:reference", authenticate, ctrl.checkPaymentStatus);

export default router;
