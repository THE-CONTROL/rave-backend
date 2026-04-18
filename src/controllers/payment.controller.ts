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
export const handleCallback = asyncHandler(
  async (req: Request, res: Response) => {
    const { reference } = req.query as { reference: string };

    // We don't perform logic here (wallet updates happen in the webhook)
    // We simply redirect the user back to the mobile app
    // Customize the deep link scheme to match your app setup
    const appRedirectUrl = `rave://payment-verify?reference=${reference}`;

    return res.redirect(appRedirectUrl);
  },
);

// Paystack calls this — no auth middleware, signature verified here
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

  await paymentService.handleWebhook(req.body.event, req.body.data);
  res.sendStatus(200); // Paystack requires a 200 response
});
