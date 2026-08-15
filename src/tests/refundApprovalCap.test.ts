// src/tests/refundApprovalCap.test.ts
//
// Regression test for the refund-amount-cap fix, approval side:
// shared/refundProcessing.service.ts#processRefundApproval now sums every
// already-approved/refunded RefundRequest against the same order, inside a
// Serializable transaction alongside the existing IN_REVIEW->APPROVED claim,
// and rejects an approval that would push the cumulative total over the
// order's totalAmount. Two different RefundRequest rows against the same
// order (e.g. two admins approving concurrently) could previously each pass
// an independent, unbounded check and together refund more than the
// customer ever paid.

const order = { id: "order-1", totalAmount: 1000 };

// Every RefundRequest row that currently exists against this order, keyed by
// id — mutated in place by updateMany, mirroring the real guarded-claim
// pattern used elsewhere in this codebase (see walletWithdrawal.test.ts).
let refundRequests: Record<string, any>;

const mockPrisma: any = {
  order: {
    findUnique: jest.fn(async ({ where }: any) =>
      where.id === order.id ? order : null,
    ),
  },
  refundRequest: {
    updateMany: jest.fn(async ({ where, data }: any) => {
      const row = refundRequests[where.id];
      if (!row || row.status !== where.status) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
    aggregate: jest.fn(async ({ where }: any) => {
      const rows = Object.values(refundRequests).filter(
        (r: any) =>
          r.orderId === where.orderId &&
          r.id !== where.id.not &&
          where.status.in.includes(r.status),
      );
      const sum = rows.reduce((acc: number, r: any) => acc + r.amountRequested, 0);
      return { _sum: { amountRequested: rows.length ? sum : null } };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      Object.assign(refundRequests[where.id], data);
      return refundRequests[where.id];
    }),
  },
  transaction: {
    findFirst: jest.fn(async () => ({
      reference: "FIN_paystack_ref_123",
      paymentMethod: "card",
    })),
    create: jest.fn(async ({ data }: any) => ({ id: "tx-new", ...data })),
  },
  // Real prisma.$transaction rolls back every write made inside the callback
  // if it throws — that's exactly what the fix relies on (the claim update
  // must revert if the cumulative-cap check fails). Snapshot/restore the
  // in-memory store around the callback to faithfully reproduce that, rather
  // than just invoking the callback directly.
  $transaction: jest.fn(async (cb: any) => {
    const snapshot = JSON.parse(JSON.stringify(refundRequests));
    try {
      return await cb(mockPrisma);
    } catch (err) {
      refundRequests = snapshot;
      throw err;
    }
  }),
};

jest.mock("../config/database", () => ({ prisma: mockPrisma }));

const psPost = jest.fn();
jest.mock("../services/payment.service", () => ({
  ps: { post: (...args: any[]) => psPost(...args), get: jest.fn() },
}));
jest.mock("../events/notification.events", () => ({
  notifyRefundProcessed: jest.fn(),
  notifyRefundDenied: jest.fn(),
}));

// eslint-disable-next-line import/first
import { processRefundApproval } from "../services/shared/refundProcessing.service";

describe("processRefundApproval — cumulative refund cap fix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    psPost.mockResolvedValue({ data: { data: {} } });
    refundRequests = {
      // Already approved earlier: 700 of the 1000 order total.
      "refund-earlier": {
        id: "refund-earlier",
        orderId: order.id,
        userId: "user-1",
        status: "APPROVED",
        amountRequested: 700,
        amountApproved: null,
      },
    };
  });

  it("rejects an approval that would push the cumulative refunded total over the order amount", async () => {
    refundRequests["refund-new"] = {
      id: "refund-new",
      orderId: order.id,
      userId: "user-1",
      status: "IN_REVIEW",
      amountRequested: 400, // 700 + 400 = 1100 > 1000
      amountApproved: null,
    };

    await expect(
      processRefundApproval(refundRequests["refund-new"]),
    ).rejects.toThrow(/exceed the total amount paid/i);

    // Never reached Paystack, and the claim was rolled back (still IN_REVIEW).
    expect(psPost).not.toHaveBeenCalled();
    expect(refundRequests["refund-new"].status).toBe("IN_REVIEW");
  });

  it("allows an approval that lands exactly at the remaining cap", async () => {
    refundRequests["refund-new"] = {
      id: "refund-new",
      orderId: order.id,
      userId: "user-1",
      status: "IN_REVIEW",
      amountRequested: 300, // 700 + 300 = 1000 === order total
      amountApproved: null,
    };

    const result = await processRefundApproval(refundRequests["refund-new"]);

    expect(result.amountApproved).toBe(300);
    expect(psPost).toHaveBeenCalledTimes(1);
    expect(refundRequests["refund-new"].status).toBe("REFUNDED");
  });

  it("rejects the second of two concurrently-approved requests once together they'd exceed the cap", async () => {
    // Two different RefundRequests, each individually under the order total,
    // that together exceed it — the exact scenario the fix targets (e.g. two
    // admins approving different requests against the same order at once).
    refundRequests["refund-a"] = {
      id: "refund-a",
      orderId: order.id,
      userId: "user-1",
      status: "IN_REVIEW",
      amountRequested: 200,
      amountApproved: null,
    };
    refundRequests["refund-b"] = {
      id: "refund-b",
      orderId: order.id,
      userId: "user-1",
      status: "IN_REVIEW",
      amountRequested: 200,
      amountApproved: null,
    };
    // 700 already approved + 200 + 200 = 1100 > 1000 — whichever of these is
    // processed second must be rejected once the first has committed.

    await processRefundApproval(refundRequests["refund-a"]);
    await expect(processRefundApproval(refundRequests["refund-b"])).rejects.toThrow(
      /exceed the total amount paid/i,
    );

    expect(refundRequests["refund-a"].status).toBe("REFUNDED");
    expect(refundRequests["refund-b"].status).toBe("IN_REVIEW");
  });
});
