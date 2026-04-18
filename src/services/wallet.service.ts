// src/services/wallet.service.ts
/**
 * Wallet-specific helpers that sit outside the general user.service.
 * Handles virtual account generation, top-up method listing, and
 * bank account name resolution (Paystack / Flutterwave stub).
 */

import { prisma } from "../config/database";
import { cfg } from "./config.service";

// ─────────────────────────────────────────────────────────────────────────────
// Bank account name resolution
// In production: call Paystack /bank/resolve or Flutterwave equivalent
// ─────────────────────────────────────────────────────────────────────────────

export const resolveBankAccount = async (
  _bankCode: string,
  _accountNumber: string,
): Promise<{ accountName: string }> => {
  // Stub — replace with real payment provider call:
  // const { data } = await paystack.get(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
  // return { accountName: data.account_name };
  await new Promise((r) => setTimeout(r, 800)); // simulate network
  return { accountName: "Account Holder Name" };
};

// ─────────────────────────────────────────────────────────────────────────────
// Checkout preview — pricing breakdown before order is placed
// ─────────────────────────────────────────────────────────────────────────────

export const getCheckoutPreview = async (userId: string) => {
  const cartItems = await prisma.cartItem.findMany({
    where: { userId },
    include: {
      menuItem: {
        select: {
          name: true,
          price: true,
          vendorId: true,
          images: {
            where: { isMain: true },
            select: { url: true },
            take: 1,
          },
        },
      },
    },
  });

  const subtotal = cartItems.reduce(
    (s, ci) => s + ci.menuItem.price * ci.qty,
    0,
  );

  const [vatRate, deliveryFee, serviceFee] = await Promise.all([
    cfg.fees.vatRate(),
    cfg.fees.deliveryBase(),
    cfg.fees.serviceFee(),
  ]);

  const vat = Math.round(subtotal * vatRate);
  const total = subtotal + vat + deliveryFee + serviceFee;

  return {
    subtotal,
    vat,
    deliveryFee,
    serviceFee,
    total,
    items: cartItems.map((ci) => ({
      id: ci.id,
      name: ci.menuItem.name,
      price: ci.menuItem.price,
      qty: ci.qty,
      image: ci.menuItem.images[0]?.url ?? null, // ← gets the main image URL
    })),
  };
};
