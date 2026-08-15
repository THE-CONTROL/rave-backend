// src/jobs/order.job.ts
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import {
  notifyOrderCancelled,
  notifyAdminsNewRefundRequest,
} from "../events/notification.events";

const VENDOR_ACCEPT_TIMEOUT_MINUTES = 5;

/**
 * Auto-cancels orders that have been in "new" status for longer than the
 * vendor acceptance timeout and refunds the customer.
 */
export const cleanupStaleOrders = async (): Promise<void> => {
  const cutoff = new Date(
    Date.now() - VENDOR_ACCEPT_TIMEOUT_MINUTES * 60 * 1000,
  );

  const staleOrders = await prisma.order.findMany({
    where: {
      status: "new",
      createdAt: { lt: cutoff },
    },
    select: {
      id: true,
      orderId: true,
      userId: true,
      totalAmount: true,
      items: { select: { name: true, qty: true } },
    },
  });

  if (!staleOrders.length) return;

  for (const order of staleOrders) {
    // Guard the update with `status: "new"` and check the affected row count
    // instead of an unconditional update: this job runs on a setInterval with
    // no distributed lock, so two overlapping instances (or a slow run
    // overlapping the next tick) could otherwise both load the same stale
    // order, both flip it to "cancelled", and both create a RefundRequest —
    // a real double-refund. The conditional update means only the run that
    // actually transitions the row (count === 1) goes on to create the
    // refund; a run that finds the order already moved on (count === 0)
    // skips it entirely.
    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
        where: { id: order.id, status: "new" },
        data: {
          status: "cancelled",
          cancelledBy: "store",
        },
      });
      if (claim.count === 0) {
        return false;
      }

      // The vendor never responded in time — the customer already paid, so
      // this needs a real, reviewable RefundRequest instead of the old fake
      // "refunded" log line that never moved any money.
      await tx.refundRequest.create({
        data: {
          userId: order.userId,
          orderId: order.id,
          issue: "Order auto-cancelled",
          description:
            "The vendor did not respond to this order in time, so it was automatically cancelled.",
          amountRequested: order.totalAmount,
          items: {
            create: order.items.map((item) => ({
              name: item.name,
              qty: item.qty,
            })),
          },
        },
      });

      return true;
    });

    if (!claimed) {
      logger.info(
        `[job:staleOrders] Skipped order ${order.orderId} — already left "new" status (claimed by another run or the vendor/customer).`,
      );
      continue;
    }

    await notifyOrderCancelled(order.userId, order.id, "store");
    await notifyAdminsNewRefundRequest(order.totalAmount);

    logger.info(
      `[job:staleOrders] Auto-cancelled order ${order.orderId} — refund request created for ₦${order.totalAmount}`,
    );
  }
};
