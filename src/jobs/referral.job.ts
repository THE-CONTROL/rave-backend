// src/jobs/referral.job.ts
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { REFERRAL } from "../constants";
import { notifyReferralBonus } from "../events/notification.events";

/**
 * Finds pending referrals where the referee has placed a qualifying order
 * (totalAmount >= MIN_ORDER_FOR_BONUS) and the bonus hasn't been paid yet.
 * Awards both the referrer and the referee (first-order discount handled
 * at checkout; this job handles the referrer's reward).
 */
export const processReferralBonuses = async (): Promise<void> => {
  const pendingReferrals = await prisma.referral.findMany({
    where: { status: "pending", bonusPaid: false },
    include: {
      referee: { select: { fullName: true } },
      referrer: { select: { id: true, fullName: true } },
    },
  });

  if (!pendingReferrals.length) return;

  for (const referral of pendingReferrals) {
    // Check if referee has a completed qualifying order
    const qualifyingOrder = await prisma.order.findFirst({
      where: {
        userId: referral.refereeId,
        status: "completed",
        totalAmount: { gte: REFERRAL.MIN_ORDER_FOR_BONUS },
      },
    });

    if (!qualifyingOrder) continue;

    // Award bonus to referrer
    await prisma.$transaction(async (tx) => {
      await tx.referral.update({
        where: { id: referral.id },
        data: { status: "successful", bonusPaid: true },
      });

      await tx.wallet.upsert({
        where: { userId: referral.referrerId },
        create: {
          userId: referral.referrerId,
          available: REFERRAL.REFERRER_BONUS,
        },
        update: { available: { increment: REFERRAL.REFERRER_BONUS } },
      });

      await tx.transaction.create({
        data: {
          userId: referral.referrerId,
          type: "referral_bonus",
          status: "successful",
          title: `Referral Bonus — ${referral.referee.fullName}`,
          amount: REFERRAL.REFERRER_BONUS,
        },
      });
    });

    await notifyReferralBonus(
      referral.referrerId,
      REFERRAL.REFERRER_BONUS,
      referral.referee.fullName,
    );

    logger.info(
      `[job:referral] Paid ₦${REFERRAL.REFERRER_BONUS} bonus to user ${referral.referrerId}`,
    );
  }
};
