// src/services/shared/refundProcessing.service.ts
//
// Shared Paystack-refund core, called from both vendor.service.ts (vendor
// self-serve, ownership-guarded) and admin/refundAdmin.service.ts (admin
// oversight, unrestricted). Each caller does its own lookup/ownership check
// before invoking these — this module only knows how to resolve an
// already-fetched RefundRequest, not how to authorize access to it.
import { RefundRequest } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { ps } from "../payment.service";
import * as notif from "../../events/notification.events";

export const processRefundApproval = async (
  refund: RefundRequest,
): Promise<{ amountApproved: number }> => {
  if (refund.status !== "IN_REVIEW") {
    throw AppError.badRequest(
      "This refund request has already been resolved.",
    );
  }

  // Find the original completed payment for this order so we know which
  // Paystack transaction to refund against.
  const originalTx = await prisma.transaction.findFirst({
    where: { orderId: refund.orderId, type: "order", status: "completed" },
  });
  if (!originalTx || !originalTx.reference) {
    throw AppError.badRequest(
      "Could not find the original payment for this order.",
    );
  }

  // Completed transactions are stored with a "FIN_" prefix over the real
  // Paystack reference (see verifyAndCompleteTransaction in
  // payment.service.ts) — strip it before calling Paystack.
  const paystackReference = originalTx.reference.startsWith("FIN_")
    ? originalTx.reference.slice(4)
    : originalTx.reference;

  const amountApproved = refund.amountRequested;

  try {
    await ps.post("/refund", {
      transaction: paystackReference,
      amount: Math.round(amountApproved * 100),
    });
  } catch (err: any) {
    const reason =
      err?.response?.data?.message ?? err?.message ?? "Paystack refund error";
    throw AppError.badRequest(`Refund could not be processed: ${reason}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.refundRequest.update({
      where: { id: refund.id },
      data: { status: "REFUNDED", amountApproved },
    });

    await tx.transaction.create({
      data: {
        userId: refund.userId,
        orderId: refund.orderId,
        type: "refund",
        status: "completed",
        title: refund.issue,
        amount: amountApproved,
        paymentMethod: originalTx.paymentMethod,
        reason: refund.description,
      },
    });
  });

  await notif.notifyRefundProcessed(refund.userId, amountApproved);

  return { amountApproved };
};

export const processRefundDecline = async (
  refund: RefundRequest,
  reason?: string,
): Promise<void> => {
  if (refund.status !== "IN_REVIEW") {
    throw AppError.badRequest(
      "This refund request has already been resolved.",
    );
  }

  await prisma.refundRequest.update({
    where: { id: refund.id },
    data: { status: "DECLINED", updateMessage: reason ?? null },
  });
};
