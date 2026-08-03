// src/services/wallet.service.ts
/**
 * Wallet-specific helpers that sit outside the general user.service.
 * Handles virtual account generation, top-up method listing, and
 * bank account name resolution (Paystack / Flutterwave stub).
 */

import { getCart } from "./user.service";

// ─────────────────────────────────────────────────────────────────────────────
// Checkout preview — pricing breakdown before order is placed
// ─────────────────────────────────────────────────────────────────────────────

// Delegates to getCart's summary (the one real, actively-used implementation
// — it accounts for extras, option-group sizes, and promos) instead of
// re-deriving subtotal/vat/total from a naive price*qty sum, which silently
// disagreed with what checkout actually charges whenever extras or a promo
// were involved.
export const getCheckoutPreview = async (userId: string) => {
  const { items, summary } = await getCart(userId);

  if (!summary) {
    return { subtotal: 0, vat: 0, deliveryFee: 0, serviceFee: 0, total: 0, items: [] };
  }

  return {
    subtotal: summary.subtotal,
    vat: summary.vat,
    deliveryFee: summary.deliveryFee,
    serviceFee: summary.serviceFee,
    total: summary.total,
    items: items.map((item) => ({
      id: item.id,
      name: item.menuItem.name,
      price: item.currentPrice,
      qty: item.qty,
      image: item.menuItem.images.find((img) => img.isMain)?.url ?? null,
    })),
  };
};
