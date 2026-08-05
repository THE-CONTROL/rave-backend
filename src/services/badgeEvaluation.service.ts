// src/services/badgeEvaluation.service.ts
//
// Badges previously had a full unlock/progress schema (VendorBadge.state,
// .current, .earnedAt) that nothing ever wrote to — an admin could create a
// Badge with requirements, but no vendor could ever actually earn one.
// This is the engine that's missing: requirements are now tied to a real,
// computable BadgeMetric, and this file re-evaluates a vendor's badges
// whenever one of those metrics could have changed.
import { BadgeMetric } from "@prisma/client";
import { prisma } from "../config/database";

const computeMetricValue = async (
  vendorId: string,
  metric: BadgeMetric,
): Promise<number> => {
  switch (metric) {
    case "total_orders":
      return prisma.order.count({ where: { vendorId, status: "completed" } });
    case "total_revenue": {
      const agg = await prisma.transaction.aggregate({
        where: { vendorId, type: "order", status: "completed" },
        _sum: { amount: true },
      });
      return agg._sum.amount ?? 0;
    }
    case "total_reviews": {
      const vendor = await prisma.vendorProfile.findUnique({
        where: { id: vendorId },
        select: { totalReviews: true },
      });
      return vendor?.totalReviews ?? 0;
    }
  }
};

/**
 * Re-checks every not-yet-unlocked badge for a vendor and unlocks any whose
 * requirements are now all met. Achievements are permanent once unlocked —
 * this never re-locks a badge even if a metric later regresses (e.g. a
 * refunded order lowering total_revenue).
 *
 * A badge with multiple requirements only unlocks once ALL are met;
 * `current` (a single int the schema provides for progress display) tracks
 * whichever requirement is furthest from completion, since there's no
 * per-requirement progress field to track them independently.
 */
export const evaluateVendorBadges = async (vendorId: string): Promise<void> => {
  const vendorBadges = await prisma.vendorBadge.findMany({
    where: { vendorId, state: { not: "unlocked" } },
    include: { badge: { include: { requirements: true } } },
  });

  for (const vb of vendorBadges) {
    const requirements = vb.badge.requirements;
    if (requirements.length === 0) continue;

    const progress = await Promise.all(
      requirements.map(async (req) => {
        const target = req.total ?? 0;
        const value = await computeMetricValue(vendorId, req.metric);
        return { value, target, ratio: target > 0 ? value / target : 1 };
      }),
    );

    const allMet = progress.every((p) => p.ratio >= 1);
    const bottleneck = progress.reduce((min, p) => (p.ratio < min.ratio ? p : min));

    await prisma.vendorBadge.update({
      where: { id: vb.id },
      data: {
        current: bottleneck.value,
        state: allMet ? "unlocked" : "in_progress",
        ...(allMet ? { earnedAt: new Date() } : {}),
      },
    });
  }
};

/** Called when a new badge is created — gives every existing vendor a row
 * to track progress on it, then checks whether anyone already qualifies. */
export const seedBadgeForAllVendors = async (badgeId: string): Promise<void> => {
  const vendors = await prisma.vendorProfile.findMany({ select: { id: true } });
  if (vendors.length === 0) return;

  await prisma.vendorBadge.createMany({
    data: vendors.map((v) => ({ vendorId: v.id, badgeId })),
    skipDuplicates: true,
  });

  await Promise.all(vendors.map((v) => evaluateVendorBadges(v.id)));
};

/** Called after a requirement is added/edited — a changed target or metric
 * could newly qualify vendors who were already tracking this badge. */
export const evaluateAllVendorsForBadge = async (badgeId: string): Promise<void> => {
  const vendorBadges = await prisma.vendorBadge.findMany({
    where: { badgeId, state: { not: "unlocked" } },
    select: { vendorId: true },
  });
  await Promise.all(vendorBadges.map((vb) => evaluateVendorBadges(vb.vendorId)));
};

/** Called on vendor signup — gives a new vendor visibility into every
 * existing badge (as locked/in_progress) instead of seeing none at all. */
export const seedVendorBadges = async (vendorId: string): Promise<void> => {
  const badges = await prisma.badge.findMany({ select: { id: true } });
  if (badges.length === 0) return;

  await prisma.vendorBadge.createMany({
    data: badges.map((b) => ({ vendorId, badgeId: b.id })),
    skipDuplicates: true,
  });
};
