// src/controllers/payment.controller.ts
import { Request, Response } from "express";
import crypto from "crypto";
import { ok, asyncHandler, created } from "../utils";
import * as paymentService from "../services/payment.service";
import * as userService from "../services/user.service";
import { AuthenticatedRequest } from "../types";

const uid = (req: Request) => (req as AuthenticatedRequest).user.id;

// ─────────────────────────────────────────────────────────────────────────────
// Banks
// ─────────────────────────────────────────────────────────────────────────────

export const listBanks = asyncHandler(async (_req, res) => {
  ok(res, await paymentService.getNigerianBanks());
});

export const resolveAccount = asyncHandler(async (req, res) => {
  const { accountNumber, bankCode } = req.query as {
    accountNumber: string;
    bankCode: string;
  };
  const accountName = await paymentService.resolveAccountName(
    accountNumber,
    bankCode,
  );
  ok(res, { accountName });
});

// ─────────────────────────────────────────────────────────────────────────────
// Initialize Payment — no order created yet
// ─────────────────────────────────────────────────────────────────────────────

export const initializePayment = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await paymentService.initializePayment(uid(req), req.body);
    ok(res, result, "Payment initialized.");
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Create Order — called after frontend confirms payment success
// ─────────────────────────────────────────────────────────────────────────────

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const result = await userService.createOrder(uid(req), req.body);
  created(res, result, "Order placed successfully.");
});

// ─────────────────────────────────────────────────────────────────────────────
// Check Payment Status — polled by frontend after browser closes
// ─────────────────────────────────────────────────────────────────────────────

export const checkPaymentStatus = asyncHandler(async (req, res) => {
  const { reference } = req.params;
  const result = await paymentService.checkPaymentStatus(reference);
  ok(res, result);
});

// ─────────────────────────────────────────────────────────────────────────────
// Paystack Callback — browser redirect after payment
// ─────────────────────────────────────────────────────────────────────────────

export const handleCallback = async (req: Request, res: Response) => {
  const { reference } = req.query;

  if (!reference) {
    res.send(buildClosePage());
    return;
  }

  // Verify and create FIN_ record — this ensures checkPaymentStatus
  // succeeds on the first poll even if the webhook hasn't fired yet
  try {
    await paymentService.verifyPayment(reference as string);
  } catch {
    // Swallow — webhook is the backup, polling will retry
  }

  res.send(buildClosePage());
};

// Returns an HTML page that closes itself so openBrowserAsync resolves
function buildClosePage(): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Payment Complete</title>
        <script>
          window.close();
        </script>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: #f9fafb;
            color: #344054;
          }
          .icon { font-size: 64px; margin-bottom: 16px; }
          h2 { font-size: 22px; font-weight: 700; margin: 0 0 8px; }
          p { font-size: 15px; color: #667085; margin: 0; text-align: center; }
        </style>
      </head>
      <body>
        <div class="icon">✅</div>
        <h2>Payment Received</h2>
        <p>You can close this page and return to the app.</p>
      </body>
    </html>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook — Paystack server-to-server notification
// ─────────────────────────────────────────────────────────────────────────────

export const webhook = asyncHandler(async (req: Request, res: Response) => {
  const secret = process.env.PAYSTACK_SECRET_KEY ?? "";
  const hash = crypto
    .createHmac("sha512", secret)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    // Return 200 so Paystack stops retrying invalid signature attempts
    res.sendStatus(200);
    return;
  }

  // Acknowledge immediately — Paystack requires 200 within 5 seconds
  res.sendStatus(200);

  // Process async — idempotency check (FIN_ prefix) handles retries safely
  await paymentService.handleWebhook(req.body.event, req.body.data);
});
