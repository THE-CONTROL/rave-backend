import axios from "axios";

const ps = axios.create({
  baseURL: "https://api.paystack.co",
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
});

// ── Initialize a transaction (card payment / top-up) ──────────────────────────
export const initializeTransaction = async (opts: {
  email: string;
  amount: number; // in NAIRA — we convert to kobo
  reference: string;
  metadata?: Record<string, unknown>;
}): Promise<{ authorizationUrl: string; reference: string }> => {
  const { data } = await ps.post("/transaction/initialize", {
    email: opts.email,
    amount: Math.round(opts.amount * 100), // kobo
    reference: opts.reference,
    metadata: opts.metadata,
    callback_url: `${process.env.APP_URL}payments/callback`,
  });
  return {
    authorizationUrl: data.data.authorization_url,
    reference: data.data.reference,
  };
};

// ── Verify a transaction ──────────────────────────────────────────────────────
export const verifyTransaction = async (
  reference: string,
): Promise<{
  status: string;
  amount: number;
  email: string;
  metadata: any;
}> => {
  const { data } = await ps.get(`/transaction/verify/${reference}`);
  return {
    status: data.data.status,
    amount: data.data.amount / 100, // convert from kobo
    email: data.data.customer.email,
    metadata: data.data.metadata,
  };
};

// ── Create a transfer recipient ───────────────────────────────────────────────
export const createTransferRecipient = async (opts: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<string> => {
  const { data } = await ps.post("/transferrecipient", {
    type: "nuban",
    name: opts.name,
    account_number: opts.accountNumber,
    bank_code: opts.bankCode,
    currency: "NGN",
  });
  return data.data.recipient_code;
};

// ── Initiate a transfer (payout) ──────────────────────────────────────────────
export const initiateTransfer = async (opts: {
  amount: number;
  recipientCode: string;
  reference: string;
  reason?: string;
}): Promise<{ transferCode: string; status: string }> => {
  const { data } = await ps.post("/transfer", {
    source: "balance",
    amount: Math.round(opts.amount * 100),
    recipient: opts.recipientCode,
    reference: opts.reference,
    reason: opts.reason ?? "Payout",
  });
  return { transferCode: data.data.transfer_code, status: data.data.status };
};

// ── Resolve bank account name ─────────────────────────────────────────────────
export const resolveBankAccount = async (
  accountNumber: string,
  bankCode: string,
): Promise<string> => {
  const { data } = await ps.get(
    `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
  );
  return data.data.account_name;
};
