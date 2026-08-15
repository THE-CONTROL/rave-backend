// src/services/admin/bankAccountAdmin.service.ts
//
// Bank accounts were only ever visible nested inside a specific vendor's or
// rider's own detail view — there was no way to search across all of them,
// e.g. "has this account number been used before" for a fraud/compliance
// check. Read-only.
import { prisma } from "../../config/database";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta, maskAccountNumber } from "../../utils";
import { AppError } from "../../utils/AppError";
import { resolveAccountName } from "../payment.service";
import { decrypt, encryptSearchable } from "../../utils/crypto";

export interface ListBankAccountsQuery extends PaginationQuery {
  search?: string; // account number or account name
  isVerified?: boolean;
}

export const listBankAccounts = async (query: ListBankAccountsQuery) => {
  const { page, limit, skip } = parsePagination(query);

  // accountNumber is now stored encrypted (deterministically, via
  // encryptSearchable) — a plaintext `contains` substring search against it
  // can never match ciphertext, but an *exact* full account number still
  // matches after encrypting the search term the same way. Partial-number
  // search is no longer possible without decrypting every row; exact search
  // and name search both still work.
  const search = query.search?.trim();
  const looksLikeFullAccountNumber = !!search && /^\d{10}$/.test(search);

  const where = {
    ...(query.isVerified !== undefined && { isVerified: query.isVerified }),
    ...(search && {
      OR: [
        ...(looksLikeFullAccountNumber
          ? [{ accountNumber: encryptSearchable(search) }]
          : []),
        { accountName: { contains: search, mode: "insensitive" as const } },
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

  // Mask before returning — admins get the same masked view as vendors/
  // riders do of their own accounts; verifyBankAccount below is the one path
  // that legitimately needs the raw number, and it decrypts internally.
  const masked = accounts.map((a) => ({
    ...a,
    accountNumber: maskAccountNumber(decrypt(a.accountNumber)),
  }));

  return { accounts: masked, meta: buildMeta(total, page, limit) };
};

// Order-independent, case-insensitive comparison — Paystack often resolves
// "SURNAME FIRSTNAME" while the name on file is "Firstname Surname".
const namesMatch = (a: string, b: string) => {
  const normalize = (s: string) =>
    s
      .trim()
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .join(" ");
  return normalize(a) === normalize(b);
};

/**
 * Real verification, not a rubber stamp: re-resolves the account number
 * against Paystack and only flips isVerified if the resolved name matches
 * the name on file. Never silently trusts what the vendor/rider submitted.
 */
export const verifyBankAccount = async (id: string) => {
  const account = await prisma.bankAccount.findUnique({ where: { id } });
  if (!account) throw AppError.notFound("Bank account");
  if (account.isVerified) throw AppError.badRequest("This bank account is already verified.");

  const resolvedName = await resolveAccountName(
    decrypt(account.accountNumber),
    account.bankCode,
  );

  if (!namesMatch(resolvedName, account.accountName)) {
    throw AppError.badRequest(
      `Resolved account name "${resolvedName}" does not match the name on file ("${account.accountName}"). Not verified.`,
    );
  }

  return prisma.bankAccount.update({ where: { id }, data: { isVerified: true } });
};
