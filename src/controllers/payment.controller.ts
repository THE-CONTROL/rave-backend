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

// ── Paystack Callback ─────────────────────────────────────────────────────────
// Called by Paystack after the user completes or abandons payment.
// Only redirects back to the app — order creation happens on the frontend
// via POST /user/orders after the frontend sees a success status.
export const handleCallback = async (req: Request, res: Response) => {
  const { reference } = req.query;

  if (!reference) {
    return res.send(
      buildRedirectPage(
        `rave://authenticated/user/transactions/cart/checkout?status=failed`,
      ),
    );
  }

  try {
    const result = await paymentService.verifyPayment(reference as string);
    const status =
      result.status === "success" || result.status === "already_processed"
        ? "success"
        : "failed";

    return res.send(
      buildRedirectPage(
        `rave://authenticated/user/transactions/cart/checkout?status=${status}&reference=${reference}`,
      ),
    );
  } catch {
    return res.send(
      buildRedirectPage(
        `rave://authenticated/user/transactions/cart/checkout?status=failed`,
      ),
    );
  }
};

// Returns an HTML page that immediately opens the app deep link
function buildRedirectPage(deepLink: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="refresh" content="0;url=${deepLink}" />
        <title>Redirecting...</title>
        <script>
          window.location.href = "${deepLink}";
        </script>
      </head>
      <body>
        <p>Redirecting back to app...</p>
        <a href="${deepLink}">Tap here if you are not redirected automatically</a>
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

  // Check for the completed leg — verifyAndCompleteTransaction creates
  // a new record with FIN_ prefix rather than updating the original
  const completedTx = await prisma.transaction.findUnique({
    where: { reference: `FIN_${reference}` },
    select: { status: true },
  });

  if (completedTx) {
    ok(res, { status: "success" });
    return;
  }

  // Check if the initiated record exists at all
  const initiatedTx = await prisma.transaction.findUnique({
    where: { reference },
    select: { status: true },
  });

  if (!initiatedTx) {
    ok(res, { status: "pending" });
    return;
  }

  // Initiated exists but no FIN_ record yet — still pending
  ok(res, { status: "pending" });
});
