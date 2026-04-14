/**
 * Payment service — all Paystack flows in one place.
 * Covers: top-up, card checkout, card save, withdrawal, rider/vendor payout,
 * bank name resolution, bank list, card merchant detection, webhook handling.
 */
import axios from "axios";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import { encrypt } from "../utils/crypto";
import * as notif from "../events/notification.events";
import { cfg } from "./config.service";

// ─────────────────────────────────────────────────────────────────────────────
// Paystack HTTP client
// ─────────────────────────────────────────────────────────────────────────────

const ps = axios.create({
  baseURL: "https://api.paystack.co",
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
});

// ─────────────────────────────────────────────────────────────────────────────
// Low-level Paystack helpers
// ─────────────────────────────────────────────────────────────────────────────

const initializeTransaction = async (opts: {
  email: string;
  amount: number; // naira — converted to kobo internally
  reference: string;
  metadata?: Record<string, unknown>;
}): Promise<{ authorizationUrl: string; reference: string }> => {
  const { data } = await ps.post("/transaction/initialize", {
    email: opts.email,
    amount: Math.round(opts.amount * 100),
    reference: opts.reference,
    metadata: opts.metadata,
    callback_url: `${process.env.APP_URL ?? ""}payments/callback`,
  });
  return {
    authorizationUrl: data.data.authorization_url,
    reference: data.data.reference,
  };
};

const createTransferRecipient = async (opts: {
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

const initiateTransfer = async (opts: {
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

// ─────────────────────────────────────────────────────────────────────────────
// Nigerian banks list (cached 24h)
// ─────────────────────────────────────────────────────────────────────────────

let banksCache: { data: any[]; cachedAt: number } | null = null;

export const getNigerianBanks = async () => {
  const TTL = 24 * 60 * 60 * 1000;
  if (banksCache && Date.now() - banksCache.cachedAt < TTL)
    return banksCache.data;

  const { data } = await ps.get("/bank?country=nigeria&perPage=100");
  const banks = data.data.map((b: any) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    slug: b.slug,
    logo: `https://nigerianbanks.xyz/logo/${b.slug}.png`,
  }));

  banksCache = { data: banks, cachedAt: Date.now() };
  return banks;
};

// ─────────────────────────────────────────────────────────────────────────────
// Resolve bank account name
// ─────────────────────────────────────────────────────────────────────────────

export const resolveAccountName = async (
  accountNumber: string,
  bankCode: string,
): Promise<string> => {
  try {
    const { data } = await ps.get(
      `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
    );
    return data.data.account_name;
  } catch {
    throw AppError.badRequest(
      "Could not verify account. Check the number and bank.",
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Card merchants
// ─────────────────────────────────────────────────────────────────────────────

export const getCardMerchants = () => [
  {
    brand: "Visa",
    logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Visa_Inc._logo.svg/800px-Visa_Inc._logo.svg.png",
    color: "#1A1F71",
    prefixes: ["4"],
  },
  {
    brand: "Mastercard",
    logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Mastercard-logo.svg/800px-Mastercard-logo.svg.png",
    color: "#EB001B",
    prefixes: [
      "51",
      "52",
      "53",
      "54",
      "55",
      "22",
      "23",
      "24",
      "25",
      "26",
      "27",
    ],
  },
  {
    brand: "Verve",
    logo: "https://nigerianbanks.xyz/logo/verve.png",
    color: "#006E51",
    prefixes: ["5061", "6500", "6501"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Initialize top-up (card or bank transfer)
// ─────────────────────────────────────────────────────────────────────────────

export const initializeTopUp = async (
  userId: string,
  amount: number,
  methodId: string,
) => {
  const minTopUp = await cfg.wallet.minTopUp();
  if (amount < minTopUp)
    throw AppError.badRequest(
      `Minimum top-up is ₦${minTopUp.toLocaleString()}.`,
    );

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) throw AppError.notFound("User");

  const reference = `topup_${userId}_${Date.now()}`;

  if (methodId === "card" || methodId === "bank_transfer") {
    const { authorizationUrl } = await initializeTransaction({
      email: user.email,
      amount,
      reference,
      metadata: { userId, type: "top_up" },
    });
    return { authorizationUrl, reference };
  }

  throw AppError.badRequest("Invalid payment method.");
};

// ─────────────────────────────────────────────────────────────────────────────
// Initialize card save (charge ₦100, refund after webhook saves card)
// ─────────────────────────────────────────────────────────────────────────────

export const initializeCardSave = async (
  userId: string,
): Promise<{ authorizationUrl: string; reference: string }> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) throw AppError.notFound("User");

  const reference = `card_save_${userId}_${Date.now()}`;
  return initializeTransaction({
    email: user.email,
    amount: 100,
    reference,
    metadata: { userId, type: "card_save" },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Paystack webhook handler
// ─────────────────────────────────────────────────────────────────────────────

export const handleWebhook = async (
  event: string,
  data: any,
): Promise<void> => {
  if (event === "charge.success") {
    const { reference, metadata, amount, authorization, customer } = data;
    const naira = amount / 100;

    // ── Top-up ──
    if (metadata?.type === "top_up") {
      const { userId } = metadata;
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) return;

      await prisma.$transaction([
        prisma.wallet.update({
          where: { userId },
          data: { available: { increment: naira } },
        }),
        prisma.transaction.create({
          data: {
            userId,
            type: "top_up",
            status: "successful",
            title: "Wallet Top Up via Card",
            amount: naira,
            reference,
            previousBalance: wallet.available,
            balanceAfter: wallet.available + naira,
          },
        }),
      ]);

      await notif.notifyWalletTopUp(userId, naira);
    }

    // ── Card save ──
    if (metadata?.type === "card_save") {
      const { userId } = metadata;

      const existing = await prisma.savedCard.findFirst({
        where: { userId, last4: authorization.last4 },
      });

      if (!existing) {
        const count = await prisma.savedCard.count({ where: { userId } });
        await prisma.savedCard.create({
          data: {
            userId,
            brand: authorization.card_type ?? "unknown",
            last4: authorization.last4,
            expMonth: authorization.exp_month,
            expYear: authorization.exp_year,
            cardHolder: customer?.name ?? "",
            authorizationCode: authorization.authorization_code,
            bin: authorization.bin,
            bankName: authorization.bank,
            countryCode: authorization.country_code ?? "NG",
            encryptedCvv: encrypt(`${authorization.last4}:paystack`),
            isDefault: count === 0,
            email: customer?.email,
          },
        });
      }

      // Refund ₦100 charge — non-critical
      ps.post("/refund", { transaction: reference }).catch(() => {});
    }

    // ── Order payment ──
    if (metadata?.type === "order_payment") {
      const { orderId } = metadata;
      await prisma.order.update({
        where: { id: orderId },
        data: { status: "new" },
      });
    }
  }

  // ── Transfer success ──
  if (event === "transfer.success") {
    const { reference } = data;
    await prisma.transaction.updateMany({
      where: { reference },
      data: { status: "successful" },
    });
  }

  // ── Transfer failed / reversed ──
  if (event === "transfer.failed" || event === "transfer.reversed") {
    const { reference } = data;
    const tx = await prisma.transaction.findFirst({ where: { reference } });
    if (tx?.userId) {
      await prisma.$transaction([
        prisma.wallet.update({
          where: { userId: tx.userId },
          data: { available: { increment: Math.abs(tx.amount) } },
        }),
        prisma.transaction.update({
          where: { id: tx.id },
          data: { status: "failed" },
        }),
      ]);
      await notif.notifyWithdrawalFailed(tx.userId, Math.abs(tx.amount));
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// User withdrawal
// ─────────────────────────────────────────────────────────────────────────────

export const processWithdrawal = async (
  userId: string,
  amount: number,
  bankId: string,
): Promise<{ reference: string }> => {
  const minWithdrawal = await cfg.wallet.minWithdrawal();
  if (amount < minWithdrawal)
    throw AppError.badRequest(
      `Minimum withdrawal is ₦${minWithdrawal.toLocaleString()}.`,
    );

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) throw AppError.notFound("Wallet");
  if (wallet.available < amount)
    throw AppError.badRequest(
      "You don't have enough balance for this withdrawal.",
    );

  const bank = await prisma.bankAccount.findFirst({
    where: { id: bankId, userId },
  });
  if (!bank) throw AppError.notFound("Bank account");

  const reference = `withdrawal_${userId}_${Date.now()}`;
  const recipientCode = await createTransferRecipient({
    name: bank.accountName,
    accountNumber: bank.accountNumber,
    bankCode: bank.bankCode,
  });
  const { status } = await initiateTransfer({
    amount,
    recipientCode,
    reference,
    reason: "Rave wallet withdrawal",
  });

  await prisma.$transaction([
    prisma.wallet.update({
      where: { userId },
      data: { available: { decrement: amount } },
    }),
    prisma.transaction.create({
      data: {
        userId,
        type: "withdrawal",
        status: status === "success" ? "successful" : "pending",
        title: `Withdrawal to ${bank.bankName}`,
        amount: -amount,
        reference,
        previousBalance: wallet.available,
        balanceAfter: wallet.available - amount,
      },
    }),
  ]);

  await notif.notifyWithdrawal(userId, amount, bank.bankName);
  return { reference };
};

// ─────────────────────────────────────────────────────────────────────────────
// Rider payout
// ─────────────────────────────────────────────────────────────────────────────

export const processRiderPayout = async (
  riderId: string,
  amount: number,
  bankId: string,
  userId: string,
): Promise<{ reference: string }> => {
  const minPayout = await cfg.wallet.minRiderPayout();
  if (amount < minPayout)
    throw AppError.badRequest(
      `Minimum payout is ₦${minPayout.toLocaleString()}.`,
    );

  const summary = await prisma.riderEarningsSummary.findUnique({
    where: { riderId },
  });
  if (!summary || summary.availableBalance < amount)
    throw AppError.badRequest(
      "You don't have enough available balance for this payout.",
    );

  const bank = await prisma.riderBankAccount.findFirst({
    where: { id: bankId, riderId },
  });
  if (!bank) throw AppError.notFound("Bank account");

  const reference = `rider_payout_${riderId}_${Date.now()}`;
  const recipientCode = await createTransferRecipient({
    name: bank.name,
    accountNumber: bank.accountNumber,
    bankCode: bank.bankCode ?? "",
  });
  const { status } = await initiateTransfer({
    amount,
    recipientCode,
    reference,
    reason: "Rave rider earnings payout",
  });

  await prisma.$transaction([
    prisma.riderEarningsSummary.update({
      where: { riderId },
      data: { availableBalance: { decrement: amount } },
    }),
    prisma.riderTransaction.create({
      data: {
        riderId,
        type: "withdrawal",
        category: "payout",
        title: `Payout to ${bank.bank}`,
        amount,
        status: status === "success" ? "completed" : "pending",
        reference,
      },
    }),
  ]);

  if (status === "success")
    await notif.notifyRiderPayout(userId, amount, bank.bank);
  return { reference };
};

// ─────────────────────────────────────────────────────────────────────────────
// Vendor payout
// ─────────────────────────────────────────────────────────────────────────────

export const processVendorPayout = async (
  vendorId: string,
  amount: number,
  bankId: string,
): Promise<{ reference: string }> => {
  const minPayout = await cfg.wallet.minVendorPayout();
  if (amount < minPayout)
    throw AppError.badRequest(
      `Minimum payout is ₦${minPayout.toLocaleString()}.`,
    );

  const bank = await prisma.vendorBankAccount.findFirst({
    where: { id: bankId, vendorId },
  });
  if (!bank) throw AppError.notFound("Bank account");

  const [earned, withdrawn] = await Promise.all([
    prisma.vendorTransaction.aggregate({
      where: { vendorId, type: "payment", status: "completed" },
      _sum: { amount: true },
    }),
    prisma.vendorTransaction.aggregate({
      where: { vendorId, type: "withdrawal" },
      _sum: { amount: true },
    }),
  ]);

  const available = (earned._sum.amount ?? 0) - (withdrawn._sum.amount ?? 0);
  if (available < amount)
    throw AppError.badRequest("Insufficient available balance.");

  const reference = `vendor_payout_${vendorId}_${Date.now()}`;
  const recipientCode = await createTransferRecipient({
    name: bank.name,
    accountNumber: bank.accountNumber,
    bankCode: bank.bankCode ?? "",
  });
  const { status } = await initiateTransfer({
    amount,
    recipientCode,
    reference,
    reason: "Rave vendor earnings payout",
  });

  await prisma.vendorTransaction.create({
    data: {
      vendorId,
      type: "withdrawal",
      category: "payout",
      title: `Payout to ${bank.bank}`,
      amount,
      status: status === "success" ? "completed" : "pending",
      reference,
    },
  });

  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: { userId: true },
  });
  if (vendor && status === "success") {
    await notif.notifyVendorPayout(vendor.userId, amount, bank.bank);
  }

  return { reference };
};
