// src/services/admin/bankAccountAdmin.service.ts
//
// Bank accounts were only ever visible nested inside a specific vendor's or
// rider's own detail view — there was no way to search across all of them,
// e.g. "has this account number been used before" for a fraud/compliance
// check. Read-only.
import { prisma } from "../../config/database";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";

export interface ListBankAccountsQuery extends PaginationQuery {
  search?: string; // account number or account name
  isVerified?: boolean;
}

export const listBankAccounts = async (query: ListBankAccountsQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.isVerified !== undefined && { isVerified: query.isVerified }),
    ...(query.search && {
      OR: [
        { accountNumber: { contains: query.search } },
        { accountName: { contains: query.search, mode: "insensitive" as const } },
      ],
    }),
  };

  const [accounts, total] = await Promise.all([
    prisma.bankAccount.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        vendor: { select: { id: true, storeName: true } },
        rider: { select: { id: true, user: { select: { fullName: true } } } },
      },
    }),
    prisma.bankAccount.count({ where }),
  ]);

  return { accounts, meta: buildMeta(total, page, limit) };
};
