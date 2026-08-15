// src/tests/refundRequestCap.test.ts
//
// Regression test for the refund-amount-cap fix, request side:
// user.service.ts#requestRefund used to accept any client-supplied
// amountRequested with no check against order.totalAmount. The fix rejects a
// request that asks for more than the order was ever worth.

const mockPrisma: any = {
  order: { findFirst: jest.fn() },
  refundRequest: { create: jest.fn() },
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
  notifyAdminsNewRefundRequest: jest.fn(),
}));

// eslint-disable-next-line import/first
import { requestRefund } from "../services/user.service";

describe("requestRefund — rejects amountRequested over the order total", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.order.findFirst.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      totalAmount: 1000,
    });
  });

  it("rejects a refund request for more than the order total", async () => {
    await expect(
      requestRefund("user-1", {
        orderId: "order-1",
        issue: "Item missing",
        description: "One item was missing from the delivery",
        amountRequested: 1500,
        items: [{ name: "Jollof Rice", qty: 1 }],
      }),
    ).rejects.toThrow(/exceed the order total/i);

    expect(mockPrisma.refundRequest.create).not.toHaveBeenCalled();
  });

  it("allows a refund request at or under the order total", async () => {
    mockPrisma.refundRequest.create.mockResolvedValueOnce({
      id: "refund-1",
      amountRequested: 1000,
      items: [],
    });

    const result = await requestRefund("user-1", {
      orderId: "order-1",
      issue: "Item missing",
      description: "One item was missing from the delivery",
      amountRequested: 1000,
      items: [{ name: "Jollof Rice", qty: 1 }],
    });

    expect(result.id).toBe("refund-1");
    expect(mockPrisma.refundRequest.create).toHaveBeenCalledTimes(1);
  });
});
