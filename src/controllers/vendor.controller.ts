// src/controllers/vendor.controller.ts
import { Request, Response } from "express";
import * as vendorService from "../services/vendor.service";
import { prisma } from "../config/database";
import { AuthenticatedRequest, extractPagination } from "../types";
import { ok, created, noContent, asyncHandler } from "../utils";

const uid = (req: Request) => (req as AuthenticatedRequest).user.id;

// ── Profile ──────────────────────────────────────────────────────────────────

export const getProfile = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getVendorProfile(uid(req)));
});

export const updateProfile = asyncHandler(async (req, res) => {
  ok(
    res,
    await vendorService.updateVendorProfile(uid(req), req.body),
    "Profile updated.",
  );
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await vendorService.changeVendorPassword(
    uid(req),
    currentPassword,
    newPassword,
  );
  ok(res, null, "Password changed successfully.");
});

export const deleteAccount = asyncHandler(async (req, res) => {
  await vendorService.deleteVendorAccount(uid(req));
  ok(res, null, "Account deactivated.");
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

export const getDashboard = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getDashboard(uid(req)));
});

// ── Store Settings ────────────────────────────────────────────────────────────

export const getStoreSettings = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getStoreSettings(uid(req)));
});

export const updateStoreSettings = asyncHandler(async (req, res) => {
  ok(
    res,
    await vendorService.updateStoreSettings(uid(req), req.body),
    "Store updated.",
  );
});

export const toggleStoreOpen = asyncHandler(async (req, res) => {
  const result = await vendorService.toggleStoreOpen(uid(req));
  ok(
    res,
    result,
    result.isOpen ? "Store is now open." : "Store is now closed.",
  );
});

export const getStoreSchedules = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getStoreSchedules(uid(req)));
});

export const upsertStoreSchedules = asyncHandler(async (req, res) => {
  await vendorService.upsertStoreSchedules(uid(req), req.body.schedules);
  ok(res, null, "Schedules updated.");
});

// ── Categories ────────────────────────────────────────────────────────────────

export const getCategories = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getCategories(uid(req)));
});

export const getCategoryById = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getCategoryById(uid(req), req.params.id));
});

export const createCategory = asyncHandler(async (req, res) => {
  created(
    res,
    await vendorService.createCategory(uid(req), req.body),
    "Category created.",
  );
});

export const updateCategory = asyncHandler(async (req, res) => {
  ok(
    res,
    await vendorService.updateCategory(uid(req), req.params.id, req.body),
    "Category updated.",
  );
});

export const deleteCategories = asyncHandler(async (req, res) => {
  await vendorService.deleteCategories(uid(req), req.body.ids);
  noContent(res);
});

export const addItemsToCategory = asyncHandler(async (req, res) => {
  await vendorService.addItemsToCategory(
    uid(req),
    req.params.id,
    req.body.itemIds,
  );
  ok(res, null, "Items added to category.");
});

// ── Menu Items ────────────────────────────────────────────────────────────────

export const getMenuItems = asyncHandler(async (req, res) => {
  const result = await vendorService.getMenuItems(uid(req), req.query as any);
  ok(res, { items: result.items }, "Menu items retrieved.", result.meta);
});

export const getMenuItemById = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getMenuItemById(uid(req), req.params.id));
});

export const createMenuItem = asyncHandler(async (req, res) => {
  created(
    res,
    await vendorService.createMenuItem(uid(req), req.body),
    "Menu item created.",
  );
});

export const updateMenuItem = asyncHandler(async (req, res) => {
  ok(
    res,
    await vendorService.updateMenuItem(uid(req), req.params.id, req.body),
    "Menu item updated.",
  );
});

export const deleteMenuItems = asyncHandler(async (req, res) => {
  await vendorService.deleteMenuItems(uid(req), req.body.ids);
  noContent(res);
});

// ── Orders ────────────────────────────────────────────────────────────────────

export const getOrders = asyncHandler(async (req, res) => {
  const result = await vendorService.getVendorOrders(
    uid(req),
    (req.query.tab as string) ?? "active",
    extractPagination(req.query),
  );
  ok(res, { orders: result.orders }, "Orders retrieved.", result.meta);
});

export const getOrderById = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getVendorOrderById(uid(req), req.params.id));
});

// ── Analytics ─────────────────────────────────────────────────────────────────

export const getAnalytics = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getAnalytics(uid(req)));
});

// ── Earnings / Transactions ───────────────────────────────────────────────────

export const getEarningsSummary = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getEarningsSummary(uid(req)));
});

export const getTransactions = asyncHandler(async (req, res) => {
  const result = await vendorService.getVendorTransactions(
    uid(req),
    req.query as any,
  );
  ok(
    res,
    { transactions: result.transactions },
    "Transactions retrieved.",
    result.meta,
  );
});

export const getTransactionById = asyncHandler(async (req, res) => {
  ok(
    res,
    await vendorService.getVendorTransactionById(uid(req), req.params.id),
  );
});

export const requestPayout = asyncHandler(async (req, res) => {
  const result = await vendorService.requestPayout(
    uid(req),
    req.body.amount,
    req.body.bankId,
  );
  ok(res, result, "Payout requested.");
});

// ── Bank Accounts ─────────────────────────────────────────────────────────────

export const getBankAccounts = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getVendorBankAccounts(uid(req)));
});

export const saveBankAccount = asyncHandler(async (req, res) => {
  await vendorService.saveVendorBankAccount(uid(req), req.body);
  created(res, null, "Bank account added.");
});

export const setPrimaryBank = asyncHandler(async (req, res) => {
  await vendorService.setVendorPrimaryBank(uid(req), req.params.id);
  ok(res, null, "Primary bank updated.");
});

export const deleteBankAccount = asyncHandler(async (req, res) => {
  await vendorService.deleteVendorBankAccount(uid(req), req.params.id);
  noContent(res);
});

// ── Promotions ────────────────────────────────────────────────────────────────

export const getPromotions = asyncHandler(async (req, res) => {
  ok(
    res,
    await vendorService.getPromotions(uid(req), req.query.status as string),
  );
});

export const getPromotionById = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getPromotionById(uid(req), req.params.id));
});

export const createPromotion = asyncHandler(async (req, res) => {
  created(
    res,
    await vendorService.createPromotion(uid(req), req.body),
    "Promotion created.",
  );
});

export const updatePromotion = asyncHandler(async (req, res) => {
  ok(
    res,
    await vendorService.updatePromotion(uid(req), req.params.id, req.body),
    "Promotion updated.",
  );
});

export const deletePromotion = asyncHandler(async (req, res) => {
  await vendorService.deletePromotion(uid(req), req.params.id);
  noContent(res);
});

// ── Reviews ───────────────────────────────────────────────────────────────────

export const getRatingStats = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getVendorRatingStats(uid(req)));
});

export const getReviews = asyncHandler(async (req, res) => {
  const result = await vendorService.getVendorReviews(
    uid(req),
    req.query as any,
  );
  ok(res, { reviews: result.reviews }, "Reviews retrieved.", result.meta);
});

// ── Badges ────────────────────────────────────────────────────────────────────

export const getBadgeStats = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getBadgeStats(uid(req)));
});

export const getBadges = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getBadges(uid(req)));
});

export const getBadgeById = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getBadgeById(uid(req), req.params.id));
});

// ── Referrals ─────────────────────────────────────────────────────────────────

export const getReferralStats = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getVendorReferralStats(uid(req)));
});

// ── Notifications ─────────────────────────────────────────────────────────────

export const getNotifications = asyncHandler(async (req, res) => {
  ok(
    res,
    await vendorService.getVendorNotifications(uid(req), req.query as any),
  );
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await vendorService.markVendorNotificationsRead(uid(req));
  ok(res, null, "All notifications marked as read.");
});

export const deleteNotification = asyncHandler(async (req, res) => {
  await vendorService.deleteVendorNotification(uid(req), req.params.id);
  noContent(res);
});

export const getNotificationSettings = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getVendorNotificationSettings(uid(req)));
});

export const updateNotificationSettings = asyncHandler(async (req, res) => {
  ok(
    res,
    await vendorService.updateVendorNotificationSettings(uid(req), req.body),
    "Settings updated.",
  );
});

// ── Onboarding ────────────────────────────────────────────────────────────────
export const getVendorOnboardingState = asyncHandler(async (req, res) => {
  ok(res, await vendorService.getVendorOnboardingState(uid(req)));
});

export const saveVendorOnboardingStep = asyncHandler(async (req, res) => {
  ok(
    res,
    await vendorService.saveVendorOnboardingStep(
      uid(req),
      Number(req.params.step),
      req.body,
    ),
    "Step saved.",
  );
});

export const submitVendorOnboarding = asyncHandler(async (req, res) => {
  ok(
    res,
    await vendorService.submitVendorOnboarding(uid(req)),
    "Submitted for review.",
  );
});

// ── Push token ────────────────────────────────────────────────────────────────
export const updatePushToken = asyncHandler(async (req, res) => {
  await prisma.user.update({
    where: { id: uid(req) },
    data: { pushToken: req.body.token ?? null },
  });
  ok(res, null, "Push token updated.");
});

// ── Bank account get/update ───────────────────────────────────────────────────
export const getBankAccountById = asyncHandler(async (req, res) => {
  ok(
    res,
    await vendorService.getVendorBankAccountById(uid(req), req.params.id),
  );
});

export const updateBankAccount = asyncHandler(async (req, res) => {
  await vendorService.updateVendorBankAccount(
    uid(req),
    req.params.id,
    req.body,
  );
  ok(res, null, "Bank account updated.");
});

export const getRiderLocation = asyncHandler(async (req, res) => {
  ok(
    res,
    await vendorService.getRiderLocationForOrder(uid(req), req.params.id),
  );
});
