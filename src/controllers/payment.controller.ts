import { Request, Response } from "express";
import crypto from "crypto";
import { ok, asyncHandler } from "../utils";
import * as paymentService from "../services/payment.service";
import { AuthenticatedRequest } from "../types";

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

/**
 * Paystack GET Callback
 * This handles the browser redirect after a user completes payment.
 */
export const handleCallback = async (req: Request, res: Response) => {
  const { reference } = req.query;

  if (!reference) {
    return res.redirect(`rave://checkout-result?status=failed`);
  }

  try {
    const result = await paymentService.verifyAndCompleteTransaction(
      reference as string,
    );

    if (result.status === "success" || result.status === "already_processed") {
      return res.redirect(
        `rave://checkout-result?status=success&reference=${reference}`,
      );
    }

    return res.redirect(
      `rave://checkout-result?status=failed&reference=${reference}`,
    );
  } catch {
    return res.redirect(
      `rave://checkout-result?status=failed&reference=${reference}`,
    );
  }
};

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
