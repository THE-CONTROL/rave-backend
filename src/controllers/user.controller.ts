// src/controllers/user.controller.ts
import { Request, Response } from "express";
import * as userService from "../services/user.service";
import { prisma } from "../config/database";
import { AuthenticatedRequest, extractPagination } from "../types";
import { ok, created, noContent, asyncHandler } from "../utils";

const uid = (req: Request) => (req as AuthenticatedRequest).user.id;

// ── Profile ──────────────────────────────────────────────────────────────────

export const getProfile = asyncHandler(async (req, res) => {
  ok(res, await userService.getProfile(uid(req)));
});

export const updateProfile = asyncHandler(async (req, res) => {
  ok(
    res,
    await userService.updateProfile(uid(req), req.body),
    "Profile updated.",
  );
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await userService.changePassword(uid(req), currentPassword, newPassword);
  ok(res, null, "Password changed successfully.");
});

export const deleteAccount = asyncHandler(async (req, res) => {
  await userService.deleteAccount(uid(req));
  ok(res, null, "Account deactivated.");
});

// ── Saved Locations ───────────────────────────────────────────────────────────

export const getSavedLocations = asyncHandler(async (req, res) => {
  ok(res, await userService.getSavedLocations(uid(req)));
});

export const upsertLocation = asyncHandler(async (req, res) => {
  const locationId = req.params.id;
  const result = await userService.upsertLocation(
    uid(req),
    req.body,
    locationId,
  );
  locationId
    ? ok(res, result, "Location updated.")
    : created(res, result, "Location saved.");
});

export const deleteLocation = asyncHandler(async (req, res) => {
  await userService.deleteLocation(uid(req), req.params.id);
  noContent(res);
});

// ── Transactions ──────────────────────────────────────────────────────────────

export const getTransactions = asyncHandler(async (req, res) => {
  const result = await userService.getTransactions(uid(req), req.query as any);
  ok(
    res,
    { transactions: result.transactions },
    "Transactions retrieved.",
    result.meta,
  );
});

export const getTransactionById = asyncHandler(async (req, res) => {
  ok(res, await userService.getTransactionById(uid(req), req.params.id));
});

// ── Cart ──────────────────────────────────────────────────────────────────────

export const getCart = asyncHandler(async (req, res) => {
  ok(res, await userService.getCart(uid(req)));
});

export const addToCart = asyncHandler(async (req, res) => {
  await userService.addToCart(uid(req), req.body.menuItemId, req.body.qty);
  ok(res, null, "Item added to cart.");
});

export const updateCartItem = asyncHandler(async (req, res) => {
  await userService.updateCartItem(
    uid(req),
    req.params.menuItemId,
    req.body.qty,
  );
  ok(res, null, "Cart updated.");
});

export const removeFromCart = asyncHandler(async (req, res) => {
  await userService.removeFromCart(uid(req), req.params.menuItemId);
  noContent(res);
});

export const clearCart = asyncHandler(async (req, res) => {
  await userService.clearCart(uid(req));
  noContent(res);
});

export const processCheckout = asyncHandler(async (req, res) => {
  const result = await userService.processCheckout(uid(req), req.body);
  created(res, result, "Order initiated. Please complete payment.");
});

// ── Orders ────────────────────────────────────────────────────────────────────

export const getOrders = asyncHandler(async (req, res) => {
  const result = await userService.getOrders(uid(req), req.query as any);
  ok(res, { orders: result.orders }, "Orders retrieved.", result.meta);
});

export const getOrderById = asyncHandler(async (req, res) => {
  ok(res, await userService.getOrderById(uid(req), req.params.id));
});

export const submitReview = asyncHandler(async (req, res) => {
  await userService.submitReview(uid(req), {
    orderId: req.params.id,
    ...req.body,
  });
  created(res, null, "Review submitted. Thank you!");
});

// ── Refunds ───────────────────────────────────────────────────────────────────

export const getRefunds = asyncHandler(async (req, res) => {
  const result = await userService.getRefunds(uid(req), req.query as any);
  ok(res, { refunds: result.refunds }, "Refunds retrieved.", result.meta);
});

export const getRefundById = asyncHandler(async (req, res) => {
  ok(res, await userService.getRefundById(uid(req), req.params.id));
});

export const requestRefund = asyncHandler(async (req, res) => {
  created(
    res,
    await userService.requestRefund(uid(req), req.body),
    "Refund request submitted.",
  );
});

// ── Referrals ─────────────────────────────────────────────────────────────────

export const getReferralStats = asyncHandler(async (req, res) => {
  ok(res, await userService.getReferralStats(uid(req)));
});

export const applyReferralCode = asyncHandler(async (req, res) => {
  await userService.applyReferralCode(uid(req), req.body.code);
  ok(
    res,
    null,
    "Referral code applied successfully! Your bonus is on the way.",
  );
});

// ── Notifications ─────────────────────────────────────────────────────────────

export const getNotifications = asyncHandler(async (req, res) => {
  ok(res, await userService.getNotifications(uid(req), req.query as any));
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await userService.markAllNotificationsRead(uid(req));
  ok(res, null, "All notifications marked as read.");
});

export const deleteNotification = asyncHandler(async (req, res) => {
  await userService.deleteNotification(uid(req), req.params.id);
  noContent(res);
});

export const getNotificationSettings = asyncHandler(async (req, res) => {
  ok(res, await userService.getNotificationSettings(uid(req)));
});

export const updateNotificationSettings = asyncHandler(async (req, res) => {
  ok(
    res,
    await userService.updateNotificationSettings(uid(req), req.body),
    "Settings updated.",
  );
});

// ── Favorites ─────────────────────────────────────────────────────────────────

export const toggleFavoriteRestaurant = asyncHandler(async (req, res) => {
  const result = await userService.toggleFavoriteRestaurant(
    uid(req),
    req.params.vendorId,
  );
  ok(
    res,
    result,
    result.isFavorite ? "Added to favorites." : "Removed from favorites.",
  );
});

export const toggleFavoriteProduct = asyncHandler(async (req, res) => {
  const result = await userService.toggleFavoriteProduct(
    uid(req),
    req.params.menuItemId,
    // ← removed vendorId, service now fetches it itself
  );
  ok(
    res,
    result,
    result.isFavorite ? "Added to favorites." : "Removed from favorites.",
  );
});

// ── Push token ────────────────────────────────────────────────────────────────
export const updatePushToken = asyncHandler(async (req, res) => {
  const { token } = req.body;
  await prisma.user.update({
    where: { id: uid(req) },
    data: { pushToken: token ?? null },
  });
  ok(res, null, "Push token updated.");
});

// ── Cart promo preview ────────────────────────────────────────────────────────
export const previewPromo = asyncHandler(async (req, res) => {
  const { code, subtotal, vendorId } = req.body;
  ok(
    res,
    await userService.applyPromoCode(
      uid(req),
      code,
      Number(subtotal),
      vendorId,
    ),
  );
});

// ── Delete refund request ─────────────────────────────────────────────────────
export const deleteRefundRequest = asyncHandler(async (req, res) => {
  await userService.deleteRefundRequest(uid(req), req.params.id);
  ok(res, null, "Refund request cancelled.");
});

// ── Search suggestions ────────────────────────────────────────────────────────
export const getSearchSuggestions = asyncHandler(async (req, res) => {
  ok(res, await userService.getSearchSuggestions(uid(req)));
});

export const clearSearchHistory = asyncHandler(async (req, res) => {
  await userService.clearSearchHistory(uid(req));
  ok(res, null, "Search history cleared.");
});

export const getUsualOrders = asyncHandler(async (req, res) => {
  ok(res, await userService.getUsualOrders(uid(req)));
});

export const getFavoriteRestaurants = asyncHandler(async (req, res) => {
  ok(res, await userService.getFavoriteRestaurants(uid(req)));
});

export const getFavoriteProducts = asyncHandler(async (req, res) => {
  ok(res, await userService.getFavoriteProducts(uid(req)));
});

export const getRiderLocation = asyncHandler(async (req, res) => {
  ok(res, await userService.getRiderLocationForOrder(uid(req), req.params.id));
});
