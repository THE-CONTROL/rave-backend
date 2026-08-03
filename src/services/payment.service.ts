// src/services/payment.service.ts
import axios from "axios";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { getCart } from "./user.service";
import { cfg } from "./config.service";

// Exported so other services (e.g. vendor payouts) reuse this single
// configured client instead of creating their own Paystack axios instance.
export const ps = axios.create({
  baseURL: "https://api.paystack.co",
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Initialize Checkout
// ─────────────────────────────────────────────────────────────────────────────

export const initializeCheckout = async (
  email: string,
  amount: number,
  paymentMethod: "card" | "bank_transfer",
  type: "payment" | "order" | "refund" | "referral",
  vendorId?: string,
  userId?: string,
  orderId?: string,
  // The vendor's real order subtotal (item prices + extras, minus discounts —
  // NOT the customer's full checkout total, which also bundles delivery fee/
  // VAT/service fee that never belong to the vendor). Only meaningful for
  // type === "order"; callers for other types simply omit it.
  vendorSubtotal?: number,
) => {
  const titles: Record<string, string> = {
    order: "Order Payment",
    refund: "Refund Transaction",
    referral: "Referral Bonus",
    payment: "General Payment",
  };

  // Compute the real commission fee up front so it's persisted on the
  // Transaction row at creation time — this is what makes vendor.service.ts's
  // fee/net breakdown (and the vendor balance calculation) correct instead of
  // relying on the old `amount / 0.9` guess, which was never actually right
  // (amount is the customer's gross total, not a net-of-commission figure).
  let subtotal: number | undefined;
  let fee: number | undefined;
  if (type === "order" && vendorSubtotal != null) {
    subtotal = vendorSubtotal;
    fee = Math.round(vendorSubtotal * (await cfg.fees.vendorCommission()));
  }

  const initiatedTx = await prisma.transaction.create({
    data: {
      userId,
      vendorId,
      // Only include orderId if provided — avoids FK constraint violation
      ...(orderId ? { orderId } : {}),
      type,
      status: "initiated",
      title: titles[type] || "Transaction",
      amount,
      paymentMethod,
      ...(subtotal != null ? { subtotal } : {}),
      ...(fee != null ? { fee } : {}),
    },
  });

  const { data } = await ps.post("/transaction/initialize", {
    email,
    amount: Math.round(Math.abs(amount) * 100),
    reference: initiatedTx.reference,
    metadata: { orderId, userId, type: `${type}_payment` },
    callback_url:
      "https://rave-backend-tvrr.onrender.com/api/v1/payments/callback",
  });

  return {
    authorizationUrl: data.data.authorization_url,
    reference: initiatedTx.reference,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Initialize Payment (new two-step flow — no order created)
// ─────────────────────────────────────────────────────────────────────────────

export interface InitializePaymentInput {
  savedLocationId: string;
  paymentMethod: string;
  instructions?: string;
  contactMethod?: string;
}

export const initializePayment = async (
  userId: string,
  dto: InitializePaymentInput,
): Promise<{ paymentUrl: string; reference: string }> => {
  const { items, summary } = await getCart(userId);

  if (!items.length || !summary) {
    throw AppError.badRequest("Your cart is empty.");
  }

  const loc = await prisma.savedLocation.findFirst({
    where: { id: dto.savedLocationId, userId },
  });
  if (!loc) throw AppError.notFound("Saved location");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) throw AppError.notFound("User not found");

  const vendorId = items[0].menuItem.vendorId;

  // Pass undefined for orderId — no order exists yet. summary.taxableAmount
  // is the vendor's real item subtotal (post-discount, pre-VAT/service/
  // delivery-fee) — see getCart in user.service.ts — which is what commission
  // must be calculated against, not the customer's full checkout total.
  const payment = await initializeCheckout(
    user.email,
    summary.total,
    dto.paymentMethod as "card" | "bank_transfer",
    "order",
    vendorId,
    userId,
    undefined,
    summary.taxableAmount,
  );

  // Persist the order intent keyed by the payment reference, so the server can
  // create the order the moment payment is verified (in the callback or the
  // webhook) — without depending on the app returning to the foreground. If
  // the user closes the browser after paying, the order is still created.
  await prisma.pendingOrder.upsert({
    where: { reference: payment.reference as string },
    update: {
      savedLocationId: dto.savedLocationId,
      paymentMethod: dto.paymentMethod,
      contactMethod: dto.contactMethod ?? "in-app",
      instructions: dto.instructions ?? null,
    },
    create: {
      reference: payment.reference as string,
      userId,
      savedLocationId: dto.savedLocationId,
      paymentMethod: dto.paymentMethod,
      contactMethod: dto.contactMethod ?? "in-app",
      instructions: dto.instructions ?? null,
    },
  });

  return {
    paymentUrl: payment.authorizationUrl,
    reference: payment.reference as string,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Verify Payment — delegates to verifyAndCompleteTransaction
// ─────────────────────────────────────────────────────────────────────────────

export const verifyPayment = async (reference: string) => {
  return verifyAndCompleteTransaction(reference);
};

/**
 * Verify a payment AND create its order server-side, from the PendingOrder
 * intent saved at init time. Safe to call from the browser callback, the
 * Paystack webhook, and the app — all paths are idempotent:
 *  - verifyAndCompleteTransaction no-ops if the FIN_ record exists
 *  - createOrder no-ops if an order with this reference already exists
 * This is what makes a successful payment always produce an order, even if the
 * app never returns to the foreground after the Paystack browser closes.
 */
export const finalizeOrderFromPayment = async (
  reference: string,
): Promise<{ status: string; orderId?: string }> => {
  // 1. Verify + write the completed (FIN_) transaction. Throws if not success.
  await verifyAndCompleteTransaction(reference);

  // 2. Atomically CLAIM the order intent. deleteMany returns a count; only the
  //    caller that actually deleted the row (count === 1) proceeds to create
  //    the order. A simultaneous callback + webhook can't both win this, so we
  //    never double-create even though evidenceUrl isn't a DB-unique column.
  const pending = await prisma.pendingOrder.findUnique({
    where: { reference },
  });
  if (!pending) {
    return { status: "already_finalized" };
  }

  const claim = await prisma.pendingOrder.deleteMany({ where: { reference } });
  if (claim.count === 0) {
    // Another path (webhook/callback/app) claimed it first.
    return { status: "already_finalized" };
  }

  // 3. Create the order from the claimed intent (also idempotent on reference).
  const { createOrder } = await import("./user.service");
  const result = await createOrder(pending.userId, {
    savedLocationId: pending.savedLocationId,
    paymentMethod: pending.paymentMethod as any,
    contactMethod: pending.contactMethod as any,
    instructions: pending.instructions ?? undefined,
    reference,
  });

  return { status: "success", orderId: result.orderId };
};


// ─────────────────────────────────────────────────────────────────────────────
// 4. Verify & Complete Transaction
// ─────────────────────────────────────────────────────────────────────────────

export const verifyAndCompleteTransaction = async (
  paystackTransactionId: string,
) => {
  // Verify with Paystack
  const { data: psResponse } = await ps.get(
    `/transaction/verify/${paystackTransactionId}`,
  );

  if (psResponse.data.status !== "success") {
    throw AppError.badRequest("Paystack confirms payment was not successful.");
  }

  const ourReference = psResponse.data.reference;

  // Find the initiated record
  const initiatedTx = await prisma.transaction.findUnique({
    where: { reference: ourReference },
  });

  if (!initiatedTx) {
    throw AppError.notFound("Initial transaction record not found");
  }

  // Idempotency: check if FIN_ record already exists
  const alreadyCompleted = await prisma.transaction.findUnique({
    where: { reference: `FIN_${ourReference}` },
  });

  if (alreadyCompleted) {
    return {
      status: "already_processed",
      reference: alreadyCompleted.reference,
    };
  }

  // Create the completed transaction record
  const result = await prisma.transaction.create({
    data: {
      userId: initiatedTx.userId,
      vendorId: initiatedTx.vendorId,
      ...(initiatedTx.orderId ? { orderId: initiatedTx.orderId } : {}),
      type: initiatedTx.type,
      status: "completed",
      title: initiatedTx.title,
      amount: initiatedTx.amount,
      paymentMethod: initiatedTx.paymentMethod,
      reference: `FIN_${ourReference}`,
      subtotal: initiatedTx.subtotal,
      fee: initiatedTx.fee,
    },
  });

  return {
    status: "success",
    reference: result.reference,
    type: result.type,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. Check Payment Status — used by polling
// ─────────────────────────────────────────────────────────────────────────────

export const checkPaymentStatus = async (
  reference: string,
): Promise<{ status: "success" | "failed" | "pending" }> => {
  // First check if FIN_ record already exists (fastest path)
  const completedTx = await prisma.transaction.findUnique({
    where: { reference: `FIN_${reference}` },
    select: { status: true },
  });

  if (completedTx) {
    return { status: "success" };
  }

  // FIN_ record doesn't exist yet — verify directly with Paystack now.
  // This handles the case where the browser was closed before Paystack
  // redirected to our callback URL.
  try {
    const result = await verifyAndCompleteTransaction(reference);
    if (result.status === "success" || result.status === "already_processed") {
      return { status: "success" };
    }
  } catch {
    // Payment not successful yet or Paystack returned failure
  }

  return { status: "pending" };
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. Webhook & Utilities
// ─────────────────────────────────────────────────────────────────────────────

export const handleWebhook = async (event: string, data: any) => {
  if (event === "charge.success") {
    // Paystack sends our reference as data.reference. Finalize the order from
    // the saved intent so a successful charge always produces an order, even
    // if the customer never returned to the app. Falls back to data.id for the
    // transaction verification path. Idempotent across callback/app/webhook.
    const reference = data?.reference ?? data?.id;
    try {
      await finalizeOrderFromPayment(reference);
    } catch {
      // If order intent is missing (e.g. a non-order payment), still ensure
      // the transaction itself is verified/completed.
      await verifyAndCompleteTransaction(data.id).catch(() => undefined);
    }
  }
};

export const getNigerianBanks = async () => {
  const { data } = await ps.get("/bank?country=nigeria");
  return data.data.map((b: any) => ({
    name: b.name,
    code: b.code,
    slug: b.slug,
  }));
};

export const resolveAccountName = async (
  accountNumber: string,
  bankCode: string,
) => {
  try {
    const { data } = await ps.get(
      `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
    );
    return data.data.account_name;
  } catch {
    return "Could not verify";
  }
};
