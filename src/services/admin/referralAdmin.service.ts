// src/services/admin/referralAdmin.service.ts
//
// Referral bonus amounts are admin-configurable (PlatformConfig), but the
// actual referral records — who referred whom, whether the bonus paid out —
// had zero admin visibility. Read-only; bonus payout logic stays in
// user.service.ts's order-completion flow.
import { prisma } from "../../config/database";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";

export interface ListReferralsQuery extends PaginationQuery {
  status?: string;
  bonusPaid?: boolean;
}

export const listReferrals = async (query: ListReferralsQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.status && { status: query.status }),
    ...(query.bonusPaid !== undefined && { bonusPaid: query.bonusPaid }),
  };

  const [referrals, total] = await Promise.all([
    prisma.referral.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        referrer: { select: { id: true, fullName: true, email: true } },
        referee: { select: { id: true, fullName: true, email: true } },
      },
    }),
    prisma.referral.count({ where }),
  ]);

  return { referrals, meta: buildMeta(total, page, limit) };
};
