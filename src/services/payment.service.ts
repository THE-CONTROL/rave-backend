import axios from "axios";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";

const ps = axios.create({
  baseURL: "https://api.paystack.co",
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Initialize Checkout (The "Initiated" Phase)
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
  // 1. Dynamic title based on type for a better UI ledger
  const titles: Record<string, string> = {
    order: "Order Payment",
    refund: "Refund Transaction",
    referral: "Referral Bonus",
    payment: "General Payment",
  };

  // 2. Create the record as 'initiated'
  const initiatedTx = await prisma.transaction.create({
    data: {
      userId,
      orderId,
      vendorId,
      type,
      status: "initiated",
      title: titles[type] || "Transaction",
      amount,
      paymentMethod,
    },
  });

  // 3. Initialize with Paystack
  const { data } = await ps.post("/transaction/initialize", {
    email,
    amount: Math.round(Math.abs(amount) * 100), // Ensure absolute positive value in Kobo
    reference: initiatedTx.reference,
    metadata: { orderId, userId, type: `${type}_payment` },
    callback_url: "exp://10.247.23.161:8081/checkout-result",
  });

  return {
    authorizationUrl: data.data.authorization_url,
    reference: initiatedTx.reference,
  };
};

// ──────────────────s───────────────────────────────────────────────────────────
// 2. Verification & Reconciliation (The "Completed" Phase)
// ─────────────────────────────────────────────────────────────────────────────
export const verifyAndCompleteTransaction = async (
  paystackTransactionId: string,
) => {
  /**
   * STEP A: Verify the payment with Paystack to get our reference back.
   */
  const { data: psResponse } = await ps.get(
    `/transaction/verify/${paystackTransactionId}`,
  );

  if (psResponse.data.status !== "success") {
    throw AppError.badRequest("Paystack confirms payment was not successful.");
  }

  const ourReference = psResponse.data.reference;

  /**
   * STEP B: Find the 'initiated' record.
   */
  const initiatedTx = await prisma.transaction.findUnique({
    where: { reference: ourReference },
  });

  if (!initiatedTx) {
    throw AppError.notFound("Initial transaction record not found");
  }

  /**
   * STEP C: Idempotency Check.
   * Verify if the 'completed' leg (FIN_) already exists.
   */
  const alreadyCompleted = await prisma.transaction.findUnique({
    where: { reference: `FIN_${ourReference}` },
  });

  if (alreadyCompleted) {
    return {
      status: "already_processed",
      reference: alreadyCompleted.reference,
    };
  }

  /**
   * STEP D: Create the NEW 'completed' Transaction record.
   * This handles the actual ledger entry without touching any other models.
   */
  const result = await prisma.transaction.create({
    data: {
      userId: initiatedTx.userId,
      vendorId: initiatedTx.vendorId,
      orderId: initiatedTx.orderId,
      type: initiatedTx.type,
      status: "completed",
      title: initiatedTx.title,
      amount: initiatedTx.amount,
      paymentMethod: initiatedTx.paymentMethod,
      reference: `FIN_${ourReference}`, // Unique suffix to maintain DB integrity
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
// 3. Webhook & Utilities
// ─────────────────────────────────────────────────────────────────────────────
export const handleWebhook = async (event: string, data: any) => {
  if (event === "charge.success") {
    // data.id is the Paystack internal transaction ID
    await verifyAndCompleteTransaction(data.id);
  }
};

export const getNigerianBanks = async () => {
  const { data } = await ps.get("/bank?country=nigeria&perPage=100");
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
    throw AppError.badRequest("Account verification failed.");
  }
};
