// src/jobs/referral.job.ts
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { settleReferralIfQualified } from "../services/user.service";

/**
 * Sweeps every pending, unpaid referral and settles the ones whose referee
 * has met their role-specific qualifying activity (a completed order for a
 * customer, a completed delivery for a rider, a fulfilled order for a vendor).
 *
 * The actual crediting — both the referee's and the referrer's bonus, plus the
 * referrer notification — lives in `settleReferralIfQualified`, which is
 * idempotent (guarded by `bonusPaid`). Customer referees are usually already
 * settled the instant their order completes via the fast path in
 * user.service; this job is the role-aware catch-all that also covers riders
 * and vendors, who never place an order of their own.
 */
export const processReferralBonuses = async (): Promise<void> => {
  const pendingReferrals = await prisma.referral.findMany({
    where: { status: "pending", bonusPaid: false },
    select: { id: true, refereeId: true },
  });

  if (!pendingReferrals.length) return;

  let settled = 0;
  for (const referral of pendingReferrals) {
    const before = await prisma.referral.findUnique({
      where: { id: referral.id },
      select: { bonusPaid: true },
    });

    await settleReferralIfQualified(referral.refereeId);

    const after = await prisma.referral.findUnique({
      where: { id: referral.id },
      select: { bonusPaid: true },
    });
    if (!before?.bonusPaid && after?.bonusPaid) settled += 1;
  }

  if (settled > 0) {
    logger.info(`[job:referral] Settled ${settled} referral bonus(es).`);
  }
};
