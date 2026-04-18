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
  const [cartItems, wallet, savedCards, defaultAddress] = await Promise.all([
    prisma.cartItem.findMany({
      where: { userId },
      include: {
        menuItem: {
          select: { name: true, price: true, imageUrl: true, vendorId: true },
        },
      },
    }),
    prisma.wallet.findUnique({ where: { userId } }),
    prisma.savedCard.findMany({
      where: { userId },
      select: { id: true, brand: true, last4: true, isDefault: true },
    }),
    // Return the full address row — the frontend needs the id to send back
    // as addressId in processCheckout, and the address string to display
    prisma.address.findFirst({
      where: { userId, isDefault: true },
      select: { id: true, label: true, address: true, lat: true, lng: true },
    }),
  ]);

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
    walletBalance: wallet?.available ?? 0,
    canPayWithWallet: (wallet?.available ?? 0) >= total,
    // Full default address object — frontend uses id for checkout, label+address for display
    defaultAddress: defaultAddress
      ? {
          id: defaultAddress.id,
          label: defaultAddress.label,
          address: defaultAddress.address,
          lat: defaultAddress.lat,
          lng: defaultAddress.lng,
        }
      : null,
    // Keep detectedAddress as a convenience string for backwards compat
    detectedAddress: defaultAddress?.address ?? null,
    savedCards,
    items: cartItems.map((ci) => ({
      id: ci.id,
      name: ci.menuItem.name,
      price: ci.menuItem.price,
      qty: ci.qty,
      image: ci.menuItem.imageUrl,
    })),
  };
};
