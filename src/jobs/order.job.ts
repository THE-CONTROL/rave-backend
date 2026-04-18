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
    },
  });

  if (!staleOrders.length) return;

  for (const order of staleOrders) {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "cancelled",
        },
      });

      // Refund
    });

    await notifyOrderCancelled(order.userId, order.id, "store");

    logger.info(
      `[job:staleOrders] Auto-cancelled order ${order.orderId} — refunded ₦${order.totalAmount}`,
    );
  }
};
