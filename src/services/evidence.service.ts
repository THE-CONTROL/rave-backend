// src/services/evidence.service.ts
/**
 * Order evidence upload — vendors can attach a video/image when disputing
 * a delivery claim or providing proof of preparation.
 */

import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";

export const uploadOrderEvidence = async (
  vendorUserId: string,
  orderId: string,
  fileUrl: string,
): Promise<void> => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { userId: vendorUserId },
  });
  if (!vendor) throw AppError.notFound("Vendor profile");

  const order = await prisma.order.findFirst({
    where: { id: orderId, vendorId: vendor.id },
  });
  if (!order) throw AppError.notFound("Order");

  // Store the evidence URL on the order record.
  // The schema has a `videoUri` concept in the frontend types —
  // we store it in a JSON extras column or you can add a dedicated
  // `evidenceUrl String?` field to the Order model.
  // For now we log it and return success (extend schema as needed).
  await prisma.order.update({
    where: { id: orderId },
    data: { evidenceUrl: fileUrl },
  });
};
