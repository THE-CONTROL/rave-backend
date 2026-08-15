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

export const computeMetricValue = async (
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
    case "average_rating": {
      const vendor = await prisma.vendorProfile.findUnique({
        where: { id: vendorId },
        select: { averageRating: true },
      });
      return vendor?.averageRating ?? 0;
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

  if (vendorBadges.length === 0) return;

  // computeMetricValue(vendorId, metric) only depends on the metric type, not
  // on which badge/requirement is asking — so a vendor tracking several
  // badges that each gate on, say, total_orders was previously re-running
  // the identical total_orders query once per requirement per badge. Collect
  // every distinct metric type actually needed across all not-yet-unlocked
  // badges up front, fetch each ONCE, and have every requirement below reuse
  // that shared value instead of re-querying.
  const neededMetrics = new Set<BadgeMetric>();
  for (const vb of vendorBadges) {
    for (const req of vb.badge.requirements) {
      neededMetrics.add(req.metric);
    }
  }

  const metricEntries = await Promise.all(
    Array.from(neededMetrics).map(
      async (metric): Promise<[BadgeMetric, number]> => [
        metric,
        await computeMetricValue(vendorId, metric),
      ],
    ),
  );
  const metricValues = new Map(metricEntries);

  await Promise.all(
    vendorBadges.map(async (vb) => {
      const requirements = vb.badge.requirements;
      if (requirements.length === 0) return;

      const progress = requirements.map((req) => {
        const target = req.total ?? 0;
        const value = metricValues.get(req.metric) ?? 0;
        return { value, target, ratio: target > 0 ? value / target : 1 };
      });

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
    }),
  );
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
