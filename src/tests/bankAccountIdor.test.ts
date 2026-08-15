// src/tests/bankAccountIdor.test.ts
//
// Regression test for the IDOR fix in vendor.service.ts#setVendorPrimaryBank
// (and, structurally identical, rider.service.ts#setPrimaryBank): the final
// bankAccount.update used to run with `where: { id: bankId }` only, so any
// authenticated vendor could flip ANY bank account row — including one
// belonging to a completely different vendor — to `isPrimary: true` just by
// guessing/enumerating a bankId. The fix scopes both the existence check and
// the update itself to the caller's own vendorId.

const mockPrisma = {
  vendorProfile: { findUnique: jest.fn() },
  bankAccount: {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock("../config/database", () => ({ prisma: mockPrisma }));

// vendor.service.ts pulls in a large import graph (Paystack client, platform
// config, notifications) that isn't relevant to this test — isolate it so
// nothing tries to hit a real network call or unrelated DB table.
jest.mock("../services/payment.service", () => ({
  ps: { post: jest.fn(), get: jest.fn() },
}));
jest.mock("../services/config.service", () => ({
  cfg: { fees: { vendorCommission: jest.fn().mockResolvedValue(0.1) } },
}));
jest.mock("../events/notification.events", () => ({
  notifyVendorWithdrawalCompleted: jest.fn(),
  notifyVendorWithdrawalFailed: jest.fn(),
  notifyAdminsVendorSubmittedOnboarding: jest.fn(),
}));

// eslint-disable-next-line import/first
import { setVendorPrimaryBank } from "../services/vendor.service";

describe("setVendorPrimaryBank — bank account IDOR fix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects setting another vendor's bank account as primary", async () => {
    mockPrisma.vendorProfile.findUnique.mockResolvedValue({ id: "vendor-A" });
    // The targeted bankId belongs to vendor-B, so the owner-scoped lookup
    // (where: { id, vendorId: vendor-A }) never matches it and returns null.
    mockPrisma.bankAccount.findFirst.mockResolvedValue(null);

    await expect(
      setVendorPrimaryBank("user-A", "bank-belonging-to-vendor-B"),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockPrisma.bankAccount.findFirst).toHaveBeenCalledWith({
      where: { id: "bank-belonging-to-vendor-B", vendorId: "vendor-A" },
    });
    // No write should ever be attempted against a row the caller doesn't own.
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows setting the caller's own bank account as primary", async () => {
    mockPrisma.vendorProfile.findUnique.mockResolvedValue({ id: "vendor-A" });
    mockPrisma.bankAccount.findFirst.mockResolvedValue({
      id: "bank-1",
      vendorId: "vendor-A",
    });
    mockPrisma.$transaction.mockResolvedValue([{}, {}]);

    await expect(
      setVendorPrimaryBank("user-A", "bank-1"),
    ).resolves.toBeUndefined();

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // The update inside the transaction batch must also be scoped to the
    // caller's vendorId, not just the bank row's id.
    expect(mockPrisma.bankAccount.update).toHaveBeenCalledWith({
      where: { id: "bank-1", vendorId: "vendor-A" },
      data: { isPrimary: true },
    });
  });
});
