// src/tests/orderIdempotency.test.ts
//
// Regression test for the duplicate-order fix in user.service.ts#createOrder:
// idempotency used to rely solely on a check-then-act `findFirst` against
// `Order.evidenceUrl` (a plain, non-unique String column) — two concurrent
// calls for the same payment reference could both pass that check and both
// insert a row. The fix adds a DB-level `@@unique([evidenceUrl])` constraint
// (see prisma/migrations/20260815153900_add_order_evidence_url_unique) and
// makes createOrder catch the resulting Prisma P2002 unique-violation and
// return the winning caller's existing order instead of a raw error.
//
// This test forces that race deterministically: the initial idempotency
// findFirst returns null (as it would for two callers that both check before
// either has committed), order.create is made to throw the real Prisma
// unique-constraint error, and the test asserts createOrder recovers by
// looking the order back up and returning it — with no duplicate order ever
// actually created and none of the post-create side effects (cart clear,
// promo consumption) running twice.

import { Prisma } from "@prisma/client";

const mockCartItem = {
  id: "cart-item-1",
  qty: 2,
  extras: null,
  menuItem: {
    id: "menu-item-1",
    name: "Jollof Rice",
    price: 2000,
    vendorId: "vendor-1",
    images: [],
    ingredients: [],
    optionGroups: [],
  },
};

const mockPrisma: any = {
  order: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  cartItem: {
    findMany: jest.fn(async () => [mockCartItem]),
    deleteMany: jest.fn(async () => ({ count: 0 })),
  },
  promotion: {
    findMany: jest.fn(async () => []),
    updateMany: jest.fn(async () => ({ count: 0 })),
  },
  savedLocation: {
    findFirst: jest.fn(async () => ({
      id: "loc-1",
      userId: "user-1",
      description: "12 Test Street",
      latitude: 6.5,
      longitude: 3.3,
      instructions: null,
    })),
  },
  vendorProfile: {
    findUnique: jest.fn(async () => ({
      autoAcceptOrders: false,
      userId: "vendor-user-1",
      storeName: "Test Vendor",
    })),
  },
  user: {
    findUnique: jest.fn(async () => ({
      appliedPromoCode: null,
      fullName: "Test User",
    })),
    update: jest.fn(async () => ({})),
  },
  transaction: {
    updateMany: jest.fn(async () => ({ count: 0 })),
  },
};

jest.mock("../config/database", () => ({ prisma: mockPrisma }));

jest.mock("../services/config.service", () => ({
  cfg: {
    fees: {
      vatRate: jest.fn().mockResolvedValue(0.075),
      serviceFee: jest.fn().mockResolvedValue(150),
      deliveryBase: jest.fn().mockResolvedValue(800),
      vendorCommission: jest.fn().mockResolvedValue(0.1),
    },
  },
}));
jest.mock("../services/payment.service", () => ({
  ps: { post: jest.fn(), get: jest.fn() },
}));
jest.mock("../events/notification.events", () => ({
  notifyOrderPlaced: jest.fn(),
  notifyVendorNewOrder: jest.fn(),
  notifyPromoApplied: jest.fn(),
}));

// eslint-disable-next-line import/first
import { createOrder } from "../services/user.service";

describe("createOrder — duplicate-order idempotency fix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCartItem.extras = null;
  });

  it("returns the existing order instead of creating a duplicate when a concurrent caller already claimed the payment reference", async () => {
    // Both concurrent callers pass the initial check-then-act findFirst
    // (neither has committed yet)...
    mockPrisma.order.findFirst
      .mockResolvedValueOnce(null) // this call's own pre-check
      // ...but the DB unique constraint on evidenceUrl means only one
      // order.create can actually succeed. Simulate the loser's create
      // hitting the real Prisma unique-violation error.
      .mockResolvedValueOnce({ orderId: "winning-order-id" }); // post-conflict lookup

    mockPrisma.order.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed on the fields: (`evidenceUrl`)",
        { code: "P2002", clientVersion: "5.14.0", meta: { target: ["evidenceUrl"] } },
      ),
    );

    const result = await createOrder("user-1", {
      savedLocationId: "loc-1",
      paymentMethod: "card",
      reference: "PSK_shared_reference",
    });

    expect(result).toEqual({ orderId: "winning-order-id" });
    // Only one create attempt — no retry loop creating a second row.
    expect(mockPrisma.order.create).toHaveBeenCalledTimes(1);
    // The post-create side effects (cart clear, promo consumption, FIN_
    // transaction linking) must NOT run for the loser — that already
    // happened for whichever caller actually won the insert.
    expect(mockPrisma.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.transaction.updateMany).not.toHaveBeenCalled();
  });

  it("still creates a genuinely new order when there is no conflict", async () => {
    mockPrisma.order.findFirst.mockResolvedValueOnce(null);
    mockPrisma.order.create.mockResolvedValueOnce({
      id: "internal-id-1",
      orderId: "new-order-id",
    });

    const result = await createOrder("user-1", {
      savedLocationId: "loc-1",
      paymentMethod: "card",
      reference: "PSK_unique_reference",
    });

    expect(result).toEqual({ orderId: "new-order-id" });
    expect(mockPrisma.order.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-unique-violation errors from order.create instead of swallowing them", async () => {
    mockPrisma.order.findFirst.mockResolvedValueOnce(null);
    mockPrisma.order.create.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      createOrder("user-1", {
        savedLocationId: "loc-1",
        paymentMethod: "card",
        reference: "PSK_some_reference",
      }),
    ).rejects.toThrow("connection reset");
  });
});
