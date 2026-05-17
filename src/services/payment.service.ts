// src/services/payment.service.ts
import axios from "axios";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { getCart } from "./user.service";

const ps = axios.create({
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
) => {
  const titles: Record<string, string> = {
    order: "Order Payment",
    refund: "Refund Transaction",
    referral: "Referral Bonus",
    payment: "General Payment",
  };

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

  // Pass undefined for orderId — no order exists yet
  const payment = await initializeCheckout(
    user.email,
    summary.total,
    dto.paymentMethod as "card" | "bank_transfer",
    "order",
    vendorId,
    userId,
    undefined,
  );

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
    await verifyAndCompleteTransaction(data.id);
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
