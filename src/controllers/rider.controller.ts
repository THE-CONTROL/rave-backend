// src/controllers/rider.controller.ts
import { Request, Response } from "express";
import * as riderService from "../services/rider.service";
import { AuthenticatedRequest, extractPagination } from "../types";
import { ok, created, noContent, asyncHandler } from "../utils";
import { AppError } from "../utils/AppError";

const uid = (req: Request) => (req as AuthenticatedRequest).user.id;

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await riderService.getRiderProfile(uid(req)));
});

export const updateProfile = asyncHandler(
  async (req: Request, res: Response) => {
    ok(
      res,
      await riderService.updateRiderProfile(uid(req), req.body),
      "Profile updated.",
    );
  },
);

export const changePassword = asyncHandler(
  async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body;
    await riderService.changeRiderPassword(
      uid(req),
      currentPassword,
      newPassword,
    );
    ok(res, null, "Password updated.");
  },
);

export const deleteAccount = asyncHandler(
  async (req: Request, res: Response) => {
    await riderService.deleteRiderAccount(uid(req));
    ok(res, null, "Account deactivated.");
  },
);

export const toggleOnline = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await riderService.toggleOnlineStatus(uid(req), req.body.isOnline));
  },
);

export const getRiderOnboardingState = asyncHandler(async (req, res) => {
  ok(res, await riderService.getRiderOnboardingState(uid(req)));
});

export const saveRiderOnboardingStep = asyncHandler(async (req, res) => {
  ok(
    res,
    await riderService.saveRiderOnboardingStep(
      uid(req),
      Number(req.params.step),
      req.body,
    ),
    "Step saved.",
  );
});

export const submitRiderOnboarding = asyncHandler(async (req, res) => {
  ok(
    res,
    await riderService.submitRiderOnboarding(uid(req)),
    "Application submitted successfully.",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Location
// ─────────────────────────────────────────────────────────────────────────────

export const updateLocation = asyncHandler(
  async (req: Request, res: Response) => {
    const { lat, lng, address } = req.body;
    await riderService.updateLocation(uid(req), lat, lng, address);
    ok(res, null, "Location updated.");
  },
);

export const getSavedLocation = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await riderService.getSavedLocation(uid(req)));
  },
);

export const saveLocation = asyncHandler(
  async (req: Request, res: Response) => {
    const { lat, lng, address } = req.body;
    ok(
      res,
      await riderService.saveLocation(uid(req), lat, lng, address),
      "Location saved.",
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export const getDashboardStats = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await riderService.getDashboardStats(uid(req)));
  },
);

export const getAvailableOrders = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await riderService.getAvailableOrders(uid(req)));
  },
);

export const acceptOrder = asyncHandler(async (req: Request, res: Response) => {
  ok(
    res,
    await riderService.acceptOrder(uid(req), req.body.orderId),
    "Order accepted.",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Deliveries
// ─────────────────────────────────────────────────────────────────────────────

export const getOngoingDeliveries = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await riderService.getOngoingDeliveries(uid(req)));
  },
);

export const getPastDeliveries = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await riderService.getPastDeliveries(
      uid(req),
      req.query as any,
    );
    ok(res, { grouped: result.grouped }, "Deliveries retrieved.", result.meta);
  },
);

export const getDeliveryDetail = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await riderService.getDeliveryDetail(uid(req), req.params.id));
  },
);

export const updateDeliveryStatus = asyncHandler(
  async (req: Request, res: Response) => {
    ok(
      res,
      await riderService.updateDeliveryStatus(
        uid(req),
        req.params.id,
        req.body.status,
      ),
    );
  },
);

export const verifyVendorOtp = asyncHandler(
  async (req: Request, res: Response) => {
    ok(
      res,
      await riderService.verifyVendorOtp(uid(req), req.params.id, req.body.otp),
    );
  },
);

export const verifyCustomerOtp = asyncHandler(
  async (req: Request, res: Response) => {
    ok(
      res,
      await riderService.verifyCustomerOtp(
        uid(req),
        req.params.id,
        req.body.otp,
      ),
    );
  },
);

export const resendOtp = asyncHandler(async (req: Request, res: Response) => {
  ok(
    res,
    await riderService.resendOtp(uid(req), req.params.id, req.body.party),
  );
});

export const uploadPickupProof = asyncHandler(
  async (req: Request, res: Response) => {
    const { url } = req.body;
    if (!url) throw AppError.badRequest("Image URL is required.");
    ok(res, await riderService.uploadPickupProof(uid(req), req.params.id, url));
  },
);

export const uploadDeliveryProof = asyncHandler(
  async (req: Request, res: Response) => {
    const { url } = req.body;
    if (!url) throw AppError.badRequest("Image URL is required.");
    ok(
      res,
      await riderService.uploadDeliveryProof(uid(req), req.params.id, url),
    );
  },
);

export const submitIssueReport = asyncHandler(
  async (req: Request, res: Response) => {
    ok(
      res,
      await riderService.submitDeliveryIssue(uid(req), req.params.id, req.body),
      "Issue reported.",
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

export const getAnalytics = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await riderService.getAnalytics(uid(req)));
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Reviews
// ─────────────────────────────────────────────────────────────────────────────

export const getRatingStats = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await riderService.getRiderRatingStats(uid(req)));
  },
);

export const getReviews = asyncHandler(async (req: Request, res: Response) => {
  const result = await riderService.getRiderReviews(uid(req), req.query as any);
  ok(res, { reviews: result.reviews }, "Reviews retrieved.", result.meta);
});

export const getTransactions = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await riderService.getTransactions(
      uid(req),
      req.query as any,
    );
    ok(
      res,
      { transactions: result.transactions },
      "Transactions retrieved.",
      result.meta,
    );
  },
);

export const getTransactionById = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await riderService.getTransactionById(uid(req), req.params.id));
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Bank accounts
// ─────────────────────────────────────────────────────────────────────────────

export const getBankAccounts = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await riderService.getBankAccounts(uid(req)));
  },
);

export const saveBankAccount = asyncHandler(
  async (req: Request, res: Response) => {
    await riderService.saveBankAccount(uid(req), req.body);
    ok(res, null, "Bank account saved.");
  },
);

export const setPrimaryBank = asyncHandler(
  async (req: Request, res: Response) => {
    await riderService.setPrimaryBank(uid(req), req.params.id);
    ok(res, null, "Primary bank updated.");
  },
);

export const deleteBankAccount = asyncHandler(
  async (req: Request, res: Response) => {
    await riderService.deleteBankAccount(uid(req), req.params.id);
    ok(res, null, "Bank account removed.");
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────

export const getNotifications = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await riderService.getNotifications(uid(req), req.query as any));
  },
);

export const markAllNotificationsRead = asyncHandler(
  async (req: Request, res: Response) => {
    await riderService.markAllNotificationsRead(uid(req));
    ok(res, null, "All notifications marked as read.");
  },
);

export const deleteNotification = asyncHandler(
  async (req: Request, res: Response) => {
    await riderService.deleteNotification(uid(req), req.params.id);
    noContent(res);
  },
);

export const getNotificationSettings = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await riderService.getNotificationSettings(uid(req)));
  },
);

export const updateNotificationSettings = asyncHandler(
  async (req: Request, res: Response) => {
    ok(
      res,
      await riderService.updateNotificationSettings(uid(req), req.body),
      "Settings updated.",
    );
  },
);

export const getRiderCurrentLocation = asyncHandler(async (req, res) => {
  ok(
    res,
    await riderService.getRiderCurrentLocation(uid(req), req.params.orderId),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────────────────────────

export const getRiderDocuments = asyncHandler(
  async (req: Request, res: Response) => {
    ok(res, await riderService.getRiderDocuments(uid(req)));
  },
);

export const uploadRiderDocument = asyncHandler(
  async (req: Request, res: Response) => {
    const { url } = req.body;
    if (!url) throw AppError.badRequest("Document URL is required.");
    ok(
      res,
      await riderService.uploadRiderDocument(
        uid(req),
        req.params.documentId,
        url,
      ),
      "Document uploaded.",
    );
  },
);

export const submitRiderDocuments = asyncHandler(
  async (req: Request, res: Response) => {
    ok(
      res,
      await riderService.submitRiderDocuments(uid(req)),
      "Documents submitted for review.",
    );
  },
);
