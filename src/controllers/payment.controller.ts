import { Request, Response } from "express";
import crypto from "crypto";
import { ok, asyncHandler } from "../utils";
import * as paymentService from "../services/payment.service";
import { AuthenticatedRequest } from "../types";
import { prisma } from "@/config/database";

const uid = (req: Request) => (req as AuthenticatedRequest).user.id;

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

// ── Initialize Payment ────────────────────────────────────────────────────────
// Initializes Paystack transaction and returns the payment URL.
// No order is created here.
export const initializePayment = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await paymentService.initializePayment(uid(req), req.body);
    ok(res, result, "Payment initialized.");
  },
);

export const handleCallback = async (req: Request, res: Response) => {
  const { reference } = req.query;

  if (!reference) {
    res.send(buildClosePage());
    return;
  }

  try {
    await paymentService.verifyPayment(reference as string);
  } catch {
    // Even if verification fails here, webhook is the backup
  }

  // Just close — polling handles the rest
  res.send(buildClosePage());
};

function buildClosePage(): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Payment Complete</title>
        <script>
          // Close the browser tab/window
          window.close();
        </script>
        <style>
          body {
            font-family: -apple-system, sans-serif;
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
          p { font-size: 15px; color: #667085; margin: 0; }
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

export const webhook = asyncHandler(async (req: Request, res: Response) => {
  const secret = process.env.PAYSTACK_SECRET_KEY ?? "";
  const hash = crypto
    .createHmac("sha512", secret)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    res.status(400).json({ success: false, message: "Invalid signature" });
    return;
  }

  // Acknowledge first — Paystack won't retry if it gets 200 immediately
  res.sendStatus(200);

  // Process after — if this fails, your idempotency check (FIN_ prefix)
  // protects against double-processing on any retry anyway
  await paymentService.handleWebhook(req.body.event, req.body.data);
});

export const checkPaymentStatus = asyncHandler(async (req, res) => {
  const { reference } = req.params;

  // Check FIN_ record first (normal flow)
  const completedTx = await prisma.transaction.findUnique({
    where: { reference: `FIN_${reference}` },
    select: { status: true },
  });

  if (completedTx) {
    ok(res, { status: "success" });
    return;
  }

  // Also check if the initiated record itself was marked completed
  // (happens when verifyAndCompleteTransaction updates in place)
  const initiatedTx = await prisma.transaction.findUnique({
    where: { reference },
    select: { status: true },
  });

  if (initiatedTx?.status === "completed") {
    ok(res, { status: "success" });
    return;
  }

  if (initiatedTx?.status === "failed") {
    ok(res, { status: "failed" });
    return;
  }

  ok(res, { status: "pending" });
});
