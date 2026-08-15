// src/services/shared/refundProcessing.service.ts
//
// Shared Paystack-refund core, called from both vendor.service.ts (vendor
// self-serve, ownership-guarded) and admin/refundAdmin.service.ts (admin
// oversight, unrestricted). Each caller does its own lookup/ownership check
// before invoking these — this module only knows how to resolve an
// already-fetched RefundRequest, not how to authorize access to it.
import { RefundRequest, Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { logger } from "../../config/logger";
import { ps } from "../payment.service";
import * as notif from "../../events/notification.events";

export const processRefundApproval = async (
  refund: RefundRequest,
): Promise<{ amountApproved: number }> => {
  // Atomically claim the refund by moving IN_REVIEW -> APPROVED via a guarded
  // updateMany *before* calling the live Paystack refund API, AND — in the
  // same Serializable transaction — verify that this refund plus every other
  // already-approved/refunded RefundRequest against the same order doesn't
  // exceed the order's totalAmount. Two concurrent callers can race here in
  // two different ways:
  //  1. Both approving the SAME RefundRequest row (e.g. the vendor approves
  //     at the same moment an admin force-approves) — only one wins the
  //     guarded updateMany (WHERE status = IN_REVIEW); the loser sees
  //     count === 0 and exits immediately.
  //  2. Two admins approving DIFFERENT RefundRequest rows against the SAME
  //     order at the same time — each row-level claim above would succeed
  //     independently, so without the cumulative check below both could pass
  //     and together refund more than the customer ever paid. Serializable
  //     isolation guarantees one of the two transactions is aborted (Prisma
  //     throws, caller sees the error) if their reads/writes would otherwise
  //     conflict, so the cumulative total can never be computed from a stale
  //     view of "what's already approved."
  await prisma.$transaction(
    async (tx) => {
      const claimResult = await tx.refundRequest.updateMany({
        where: { id: refund.id, status: "IN_REVIEW" },
        data: { status: "APPROVED" },
      });
      if (claimResult.count === 0) {
        throw AppError.badRequest(
          "This refund request has already been resolved.",
        );
      }

      const order = await tx.order.findUnique({
        where: { id: refund.orderId },
        select: { totalAmount: true },
      });
      if (!order) {
        throw AppError.badRequest("Order not found for this refund.");
      }

      // Sum every OTHER already-approved/refunded request for this order
      // (this row was just flipped to APPROVED above, so it's excluded here
      // and added back explicitly via refund.amountRequested).
      const priorApproved = await tx.refundRequest.aggregate({
        where: {
          orderId: refund.orderId,
          id: { not: refund.id },
          status: { in: ["APPROVED", "REFUNDED"] },
        },
        _sum: { amountRequested: true },
      });

      const cumulative =
        (priorApproved._sum.amountRequested ?? 0) + refund.amountRequested;
      if (cumulative > order.totalAmount) {
        // Throwing here rolls back the whole transaction, including the
        // claim update above — the row goes back to IN_REVIEW automatically,
        // no manual revert needed.
        throw AppError.badRequest(
          "Approving this refund would exceed the total amount paid for the order.",
        );
      }

      return claimResult;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  // Find the original completed payment for this order so we know which
  // Paystack transaction to refund against.
  const originalTx = await prisma.transaction.findFirst({
    where: { orderId: refund.orderId, type: "order", status: "completed" },
  });
  if (!originalTx || !originalTx.reference) {
    // Revert the claim — nothing was actually refunded, so the request must
    // stay resolvable (not stuck in APPROVED limbo).
    await prisma.refundRequest.updateMany({
      where: { id: refund.id, status: "APPROVED" },
      data: { status: "IN_REVIEW" },
    });
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
    // Log the raw Paystack error server-side only — never forward it verbatim
    // to the client (see finding #16).
    logger.error("Paystack refund failed", {
      refundId: refund.id,
      orderId: refund.orderId,
      reason,
    });
    // Revert the claim so the refund can be retried instead of being stuck
    // "APPROVED" forever with no successful refund behind it.
    await prisma.refundRequest.updateMany({
      where: { id: refund.id, status: "APPROVED" },
      data: { status: "IN_REVIEW" },
    });
    throw AppError.badRequest(
      "Refund could not be processed. Please try again or contact support.",
    );
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
  // Same claim-first pattern as processRefundApproval: the guarded updateMany
  // is the atomic check-and-transition, so a concurrent decline/approve can
  // never both succeed against the same IN_REVIEW row.
  const claim = await prisma.refundRequest.updateMany({
    where: { id: refund.id, status: "IN_REVIEW" },
    data: { status: "DECLINED", updateMessage: reason ?? null },
  });
  if (claim.count === 0) {
    throw AppError.badRequest(
      "This refund request has already been resolved.",
    );
  }

  await notif.notifyRefundDenied(refund.userId, reason);
};
