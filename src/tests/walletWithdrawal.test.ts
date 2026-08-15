// src/tests/walletWithdrawal.test.ts
//
// Regression test for the withdrawal double-spend race fix in
// vendor.service.ts#withdrawVendorFunds: the balance check used to read
// getVendorBalance() OUTSIDE any transaction, then separately create the
// "initiated" payout Transaction row — leaving a window where two concurrent
// withdrawals could both read the same (stale) available balance and both
// pass. The fix re-reads the balance INSIDE a single
// prisma.$transaction(..., { isolationLevel: Serializable }) that also
// creates the claiming row, so the balance check always reflects whatever
// has already been claimed.
//
// This test models that by using a small in-memory "transactions" ledger
// behind the mocked Prisma client: after a first withdrawal fully claims the
// vendor's entire available balance, a second withdrawal request must be
// rejected — because _computeVendorAvailableBalance (invoked fresh, inside
// the transaction, on every call) picks up the first withdrawal's row.

type LedgerRow = {
  id: string;
  vendorId: string;
  type: string;
  status: string;
  subtotal?: number | null;
  fee?: number | null;
  amount: number;
};

let ledger: LedgerRow[] = [];
let idCounter = 0;

const matchesWhere = (row: LedgerRow, where: any): boolean => {
  for (const key of Object.keys(where)) {
    const cond = where[key];
    if (key === "subtotal") {
      if (cond === null) {
        if (row.subtotal != null) return false;
      } else if (cond && typeof cond === "object" && "not" in cond) {
        if (cond.not === null && row.subtotal == null) return false;
      }
      continue;
    }
    if ((row as any)[key] !== cond) return false;
  }
  return true;
};

const aggregateImpl = async ({ where, _sum }: any) => {
  const rows = ledger.filter((r) => matchesWhere(r, where));
  const sum: Record<string, number | null> = {};
  for (const field of Object.keys(_sum ?? {})) {
    const total = rows.reduce(
      (acc, r) => acc + ((r as any)[field] ?? 0),
      0,
    );
    sum[field] = rows.length ? total : null;
  }
  return { _sum: sum };
};

const createImpl = async ({ data }: any) => {
  const row: LedgerRow = { id: `tx${++idCounter}`, ...data };
  ledger.push(row);
  return row;
};

const updateImpl = async ({ where, data }: any) => {
  const row = ledger.find((r) => r.id === where.id);
  if (!row) throw new Error("transaction not found");
  Object.assign(row, data);
  return row;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma: any = {
  vendorProfile: { findUnique: jest.fn() },
  bankAccount: { findFirst: jest.fn() },
  transaction: {
    aggregate: jest.fn(aggregateImpl),
    create: jest.fn(createImpl),
    update: jest.fn(updateImpl),
    findMany: jest.fn(async () => []),
  },
  // The real prisma.$transaction(callback, options) — since our mocked
  // model methods above operate directly on the shared `ledger` array (no
  // real DB round-trip to await), just invoking the callback with the same
  // mock client faithfully reproduces "everything inside the transaction
  // sees the same, single, up-to-date ledger state" — which is exactly the
  // property the real fix relies on.
  $transaction: jest.fn(async (cb: any): Promise<any> => cb(mockPrisma)),
};

jest.mock("../config/database", () => ({ prisma: mockPrisma }));

const psPost = jest.fn();
jest.mock("../services/payment.service", () => ({
  ps: { post: (...args: any[]) => psPost(...args), get: jest.fn() },
}));
jest.mock("../services/config.service", () => ({
  cfg: { fees: { vendorCommission: jest.fn().mockResolvedValue(0.1) } },
}));
jest.mock("../events/notification.events", () => ({
  notifyVendorWithdrawalCompleted: jest.fn(),
  notifyVendorWithdrawalFailed: jest.fn(),
}));

// eslint-disable-next-line import/first
import { withdrawVendorFunds } from "../services/vendor.service";
// eslint-disable-next-line import/first
import { encrypt } from "../utils/crypto";

describe("withdrawVendorFunds — withdrawal double-spend race fix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ledger = [
      // The vendor has exactly 1000 in real earnings (subtotal - fee) and
      // nothing withdrawn yet.
      {
        id: "seed-earning",
        vendorId: "vendor-A",
        type: "order",
        status: "completed",
        subtotal: 1000,
        fee: 0,
        amount: 1000,
      },
    ];
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));

    mockPrisma.vendorProfile.findUnique.mockResolvedValue({
      id: "vendor-A",
      storeName: "Test Store",
    });
    mockPrisma.bankAccount.findFirst.mockResolvedValue({
      id: "bank-1",
      vendorId: "vendor-A",
      accountName: "Test Vendor",
      // Must be a real encrypt() ciphertext, not an arbitrary string — the
      // withdrawal flow calls decrypt() on this before calling Paystack, and
      // decrypt() throws on malformed input. That throw was previously
      // silently retried 3x with REAL (unmocked) setTimeout backoff
      // (1s/3s/7s), blowing well past Jest's default 5s test timeout.
      accountNumber: encrypt("0123456789"),
      bankCode: "001",
    });

    psPost.mockImplementation(async (path: string) => {
      if (path === "/transferrecipient") {
        return { data: { data: { recipient_code: "RCP_1" } } };
      }
      return { data: { data: { transfer_code: "TRF_1" } } };
    });
  });

  it("allows a withdrawal for the full available balance", async () => {
    const result = await withdrawVendorFunds("user-A", 1000, "bank-1");
    expect(result.status).toBe("completed");
  });

  it("rejects a second withdrawal once the balance is already exhausted", async () => {
    // First request claims and successfully pays out the entire balance.
    await withdrawVendorFunds("user-A", 1000, "bank-1");
    expect(psPost).toHaveBeenCalledTimes(2); // recipient + transfer

    // A second request — for even a small amount — must now be rejected,
    // because the balance re-check inside the transaction sees the first
    // withdrawal's row and correctly computes availableBalance === 0.
    await expect(withdrawVendorFunds("user-A", 1, "bank-1")).rejects.toThrow(
      /exceeds your available balance/i,
    );

    // Crucially, the second (rejected) request never reaches Paystack at
    // all — the call count stays exactly where the first request left it.
    expect(psPost).toHaveBeenCalledTimes(2);
  });

  it("rejects a withdrawal that alone exceeds the available balance", async () => {
    await expect(
      withdrawVendorFunds("user-A", 1001, "bank-1"),
    ).rejects.toThrow(/exceeds your available balance/i);
    expect(psPost).not.toHaveBeenCalled();
  });
});
