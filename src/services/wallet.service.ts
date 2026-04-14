// src/services/wallet.service.ts
/**
 * Wallet-specific helpers that sit outside the general user.service.
 * Handles virtual account generation, top-up method listing, and
 * bank account name resolution (Paystack / Flutterwave stub).
 */

import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";

// ─────────────────────────────────────────────────────────────────────────────
// Virtual bank account (for bank transfer top-ups)
// In production: call Monnify/Flutterwave to create a dedicated virtual account
// ─────────────────────────────────────────────────────────────────────────────

export const getVirtualAccount = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, accountId: true },
  });
  if (!user) throw AppError.notFound("User");

  // Deterministic fake account number derived from accountId (dev only)
  // Replace with: const acct = await monnify.createVirtualAccount(user)
  const accountNumber = user.accountId
    .replace(/[^0-9]/g, "")
    .padEnd(10, "0")
    .slice(0, 10);

  return {
    bankName: "Wema Bank (Rave/Monnify)",
    accountNumber,
    accountName: `RAVE-${user.fullName.replace(/ /g, "-").toUpperCase()}`,
    expiryMinutes: 30,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Top-up methods
// ─────────────────────────────────────────────────────────────────────────────

export const getTopUpMethods = () => [
  {
    id: "m1",
    type: "card",
    title: "Credit / Debit Card",
    description: "Instant top-up using Visa or Mastercard",
    icon: "card-outline",
    fee: 0,
    isEnabled: true,
  },
  {
    id: "m2",
    type: "bank_transfer",
    title: "Bank Transfer",
    description: "Pay into a dedicated virtual account",
    icon: "business-outline",
    fee: 0,
    isEnabled: true,
  },
  {
    id: "m3",
    type: "ussd",
    title: "USSD Code",
    description: "Dial a code from your mobile phone",
    icon: "phone-portrait-outline",
    fee: 100,
    isEnabled: true,
  },
];

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

import { cfg } from "./config.service";

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
