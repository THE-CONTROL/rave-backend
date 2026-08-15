// src/services/admin/analytics.service.ts
import { prisma } from "../../config/database";
import { Prisma } from "@prisma/client";
import { resolveDateRange } from "../../utils";

const rangeSince = (range?: string): Date => {
  const now = new Date();
  switch (range) {
    case "7d":
      return new Date(now.getTime() - 7 * 86400_000);
    case "year":
      return new Date(now.getFullYear(), 0, 1);
    case "all":
      return new Date(0);
    case "30d":
    default:
      return new Date(now.getTime() - 30 * 86400_000);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Overview — headline platform counters
// ─────────────────────────────────────────────────────────────────────────────

export const getOverview = async () => {
  const [
    roleCounts,
    activeVendors,
    verifiedRiders,
    totalOrders,
    completedRevenue,
    commission,
    refundsPaid,
    openTickets,
  ] = await Promise.all([
    prisma.user.groupBy({
      by: ["role"],
      _count: true,
      where: { role: { in: ["user", "vendor", "rider"] } },
    }),
    prisma.vendorProfile.count({ where: { storeStatus: "open" } }),
    prisma.riderProfile.count({ where: { status: "verified" } }),
    prisma.order.count(),
    prisma.order.aggregate({
      where: { status: "completed" },
      _sum: { totalAmount: true },
    }),
    prisma.transaction.aggregate({
      where: { type: "order", status: "completed" },
      _sum: { fee: true },
    }),
    prisma.refundRequest.aggregate({
      where: { status: "REFUNDED" },
      _sum: { amountApproved: true },
    }),
    prisma.reportedIssue.count({ where: { status: { not: "RESOLVED" } } }),
  ]);

  const byRole: Record<string, number> = { user: 0, vendor: 0, rider: 0 };
  for (const r of roleCounts) byRole[r.role] = r._count;

  return {
    users: byRole.user,
    vendors: byRole.vendor,
    riders: byRole.rider,
    activeVendors,
    verifiedRiders,
    totalOrders,
    completedOrderRevenue: completedRevenue._sum.totalAmount ?? 0,
    platformCommissionCollected: commission._sum.fee ?? 0,
    totalRefundsPaid: refundsPaid._sum.amountApproved ?? 0,
    openSupportTickets: openTickets,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Growth — new signups per day, by role
// ─────────────────────────────────────────────────────────────────────────────

export const getGrowth = async (range?: string) => {
  const since = rangeSince(range);

  const rows = await prisma.$queryRaw<
    Array<{ day: Date; role: string; count: bigint }>
  >`
    SELECT date_trunc('day', "createdAt") AS day, role::text AS role, count(*) AS count
    FROM "users"
    WHERE "createdAt" >= ${since} AND role IN ('user', 'vendor', 'rider')
    GROUP BY day, role
    ORDER BY day ASC
  `;

  return rows.map((r) => ({
    day: r.day,
    role: r.role,
    count: Number(r.count),
  }));
};

// ─────────────────────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────────────────────

export const getOrderAnalytics = async (range?: string) => {
  const dateFilter = resolveDateRange(range);

  const [statusBreakdown, avgOrderValue, totalCount, cancelledCount, hourly] =
    await Promise.all([
      prisma.order.groupBy({
        by: ["status"],
        where: dateFilter,
        _count: true,
      }),
      prisma.order.aggregate({ where: dateFilter, _avg: { totalAmount: true } }),
      prisma.order.count({ where: dateFilter }),
      prisma.order.count({ where: { ...dateFilter, status: "cancelled" } }),
      prisma.$queryRaw<Array<{ hour: number; dow: number; count: bigint }>>`
        SELECT
          EXTRACT(HOUR FROM "createdAt")::int AS hour,
          EXTRACT(DOW FROM "createdAt")::int AS dow,
          count(*) AS count
        FROM "orders"
        WHERE "createdAt" >= ${dateFilter.createdAt?.gte ?? new Date(0)}
        GROUP BY hour, dow
        ORDER BY count DESC
        LIMIT 10
      `,
    ]);

  return {
    statusBreakdown: statusBreakdown.map((s) => ({ status: s.status, count: s._count })),
    averageOrderValue: avgOrderValue._avg.totalAmount ?? 0,
    totalOrders: totalCount,
    cancellationRate: totalCount > 0 ? cancelledCount / totalCount : 0,
    peakTimes: hourly.map((h) => ({ hour: h.hour, dayOfWeek: h.dow, count: Number(h.count) })),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Revenue
// ─────────────────────────────────────────────────────────────────────────────

export const getRevenueAnalytics = async (range?: string) => {
  const dateFilter = resolveDateRange(range);
  const completedFilter = { ...dateFilter, status: "completed" as const };

  const [orderSums, commission, refundsPaid, trend] = await Promise.all([
    prisma.order.aggregate({
      where: completedFilter,
      _sum: { totalAmount: true, vat: true, serviceFee: true, deliveryFee: true },
    }),
    prisma.transaction.aggregate({
      where: { type: "order", status: "completed", ...dateFilter },
      _sum: { fee: true },
    }),
    prisma.refundRequest.aggregate({
      where: { status: "REFUNDED", ...dateFilter },
      _sum: { amountApproved: true },
    }),
    prisma.$queryRaw<Array<{ day: Date; revenue: number }>>`
      SELECT date_trunc('day', "createdAt") AS day, sum("totalAmount")::float AS revenue
      FROM "orders"
      WHERE status = 'completed' AND "createdAt" >= ${dateFilter.createdAt?.gte ?? new Date(0)}
      GROUP BY day
      ORDER BY day ASC
    `,
  ]);

  const grossRevenue = orderSums._sum.totalAmount ?? 0;
  const vendorCommission = commission._sum.fee ?? 0;
  const refunds = refundsPaid._sum.amountApproved ?? 0;

  return {
    grossRevenue,
    vatCollected: orderSums._sum.vat ?? 0,
    serviceFeesCollected: orderSums._sum.serviceFee ?? 0,
    deliveryFeesCollected: orderSums._sum.deliveryFee ?? 0,
    vendorCommission,
    refundsPaid: refunds,
    netPlatformRevenue: vendorCommission - refunds,
    trend: trend.map((t) => ({ day: t.day, revenue: t.revenue ?? 0 })),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Top vendors / riders
// ─────────────────────────────────────────────────────────────────────────────

export const getTopVendors = async (range?: string, limit = 10) => {
  const dateFilter = resolveDateRange(range);

  const grouped = await prisma.order.groupBy({
    by: ["vendorId"],
    where: { ...dateFilter, status: "completed" },
    _sum: { totalAmount: true },
    _count: true,
    orderBy: { _sum: { totalAmount: "desc" } },
    take: limit,
  });

  const vendors = await prisma.vendorProfile.findMany({
    where: { id: { in: grouped.map((g) => g.vendorId) } },
    select: { id: true, storeName: true, averageRating: true, logoUrl: true },
  });
  const byId = new Map(vendors.map((v) => [v.id, v]));

  return grouped.map((g) => ({
    vendor: byId.get(g.vendorId) ?? null,
    revenue: g._sum.totalAmount ?? 0,
    orderCount: g._count,
  }));
};

export const getTopRiders = async (range?: string, limit = 10) => {
  const dateFilter = resolveDateRange(range);

  const grouped = await prisma.delivery.groupBy({
    by: ["riderId"],
    where: { ...dateFilter, status: "delivered" },
    _count: { riderId: true },
    _sum: { earnings: true },
    orderBy: { _count: { riderId: "desc" } },
    take: limit,
  });

  const riders = await prisma.riderProfile.findMany({
    where: { id: { in: grouped.map((g) => g.riderId) } },
    select: {
      id: true,
      averageRating: true,
      user: { select: { fullName: true, imageUrl: true } },
    },
  });
  const byId = new Map(riders.map((r) => [r.id, r]));

  return grouped.map((g) => ({
    rider: byId.get(g.riderId) ?? null,
    completedDeliveries: g._count.riderId,
    earnings: g._sum.earnings ?? 0,
  }));
};

// ─────────────────────────────────────────────────────────────────────────────
// User engagement
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Operations — cross-model rollups otherwise only visible by drilling into
// each entity's own list page (refunds, transactions, reviews, referrals,
// badges, issues, deliveries, ads).
// ─────────────────────────────────────────────────────────────────────────────

export const getOperationsSummary = async (range?: string) => {
  const dateFilter = resolveDateRange(range);

  // Delivered-count and average-duration used to be computed by pulling
  // EVERY delivered delivery row for the range into memory (findMany, then
  // JS reduce) just to average two timestamp fields. That's unbounded — as
  // deliveries accumulate this both grows memory usage without limit and
  // gets slower every month. A single SQL aggregate does the same
  // computation (and the count) inside Postgres instead.
  const sinceDate = dateFilter.createdAt?.gte;
  const deliveryDurationAgg = await prisma.$queryRaw<
    { avg_minutes: number | null; delivered_count: bigint }[]
  >(
    sinceDate
      ? Prisma.sql`
          SELECT
            AVG(EXTRACT(EPOCH FROM ("deliveredAt" - "acceptedAt")) / 60.0) AS avg_minutes,
            COUNT(*) AS delivered_count
          FROM "deliveries"
          WHERE "status" = 'delivered'
            AND "acceptedAt" IS NOT NULL
            AND "deliveredAt" IS NOT NULL
            AND "createdAt" >= ${sinceDate}
        `
      : Prisma.sql`
          SELECT
            AVG(EXTRACT(EPOCH FROM ("deliveredAt" - "acceptedAt")) / 60.0) AS avg_minutes,
            COUNT(*) AS delivered_count
          FROM "deliveries"
          WHERE "status" = 'delivered'
            AND "acceptedAt" IS NOT NULL
            AND "deliveredAt" IS NOT NULL
        `,
  );
  const avgDeliveryMinutes = deliveryDurationAgg[0]?.avg_minutes ?? 0;
  const deliveredCount = Number(deliveryDurationAgg[0]?.delivered_count ?? 0n);

  const [
    refundsByStatus,
    refundsPaidSum,
    transactionsByType,
    reviewAgg,
    referralTotal,
    referralSuccessful,
    badgesByState,
    issuesByCategory,
    cancelledDeliveries,
    adEventsByType,
  ] = await Promise.all([
    prisma.refundRequest.groupBy({ by: ["status"], where: dateFilter, _count: true }),
    prisma.refundRequest.aggregate({
      where: { ...dateFilter, status: "REFUNDED" },
      _sum: { amountApproved: true },
    }),
    prisma.transaction.groupBy({ by: ["type"], where: dateFilter, _count: true, _sum: { amount: true } }),
    prisma.review.aggregate({
      where: dateFilter,
      _avg: { restaurantRating: true, foodRating: true, overallRating: true },
      _count: true,
    }),
    prisma.referral.count({ where: dateFilter }),
    prisma.referral.count({ where: { ...dateFilter, status: "successful" } }),
    prisma.vendorBadge.groupBy({ by: ["state"], _count: true }),
    prisma.reportedIssue.groupBy({
      by: ["category"],
      where: { ...dateFilter, status: { not: "RESOLVED" } },
      _count: { category: true },
      orderBy: { _count: { category: "desc" } },
      take: 5,
    }),
    prisma.delivery.count({ where: { ...dateFilter, status: "cancelled" } }),
    prisma.adEvent.groupBy({ by: ["event"], where: dateFilter, _count: true }),
  ]);

  return {
    refunds: {
      byStatus: refundsByStatus.map((r) => ({ status: r.status, count: r._count })),
      totalPaid: refundsPaidSum._sum.amountApproved ?? 0,
    },
    transactionsByType: transactionsByType.map((t) => ({
      type: t.type,
      count: t._count,
      total: t._sum.amount ?? 0,
    })),
    reviews: {
      averageRestaurantRating: reviewAgg._avg.restaurantRating ?? 0,
      averageFoodRating: reviewAgg._avg.foodRating ?? 0,
      averageOverallRating: reviewAgg._avg.overallRating ?? 0,
      count: reviewAgg._count,
    },
    referrals: {
      total: referralTotal,
      successful: referralSuccessful,
      conversionRate: referralTotal > 0 ? referralSuccessful / referralTotal : 0,
    },
    badges: badgesByState.map((b) => ({ state: b.state, count: b._count })),
    issues: issuesByCategory.map((i) => ({ category: i.category, count: i._count.category })),
    deliveries: {
      averageMinutes: avgDeliveryMinutes,
      delivered: deliveredCount,
      cancelled: cancelledDeliveries,
    },
    ads: adEventsByType.map((a) => ({ event: a.event, count: a._count })),
  };
};

export const getUserEngagement = async (range?: string) => {
  const dateFilter = resolveDateRange(range);

  const perUser = await prisma.order.groupBy({
    by: ["userId"],
    where: dateFilter,
    _count: true,
  });

  const orderingUsers = perUser.length;
  const repeatUsers = perUser.filter((u) => u._count > 1).length;
  const totalOrders = perUser.reduce((acc, u) => acc + u._count, 0);

  return {
    orderingUsers,
    repeatOrderRate: orderingUsers > 0 ? repeatUsers / orderingUsers : 0,
    averageOrdersPerActiveUser: orderingUsers > 0 ? totalOrders / orderingUsers : 0,
  };
};
