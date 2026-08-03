// src/jobs/order.job.ts
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { notifyOrderCancelled } from "../events/notification.events";

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
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "cancelled",
          cancelledBy: "store",
        },
      });

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
    });

    await notifyOrderCancelled(order.userId, order.id, "store");

    logger.info(
      `[job:staleOrders] Auto-cancelled order ${order.orderId} — refund request created for ₦${order.totalAmount}`,
    );
  }
};
