// src/services/admin/refundAdmin.service.ts
import { RefundStatus } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";
import * as refundProcessing from "../shared/refundProcessing.service";

export interface ListRefundsQuery extends PaginationQuery {
  status?: RefundStatus;
  vendorId?: string;
  userId?: string;
}

// No vendor-ownership filter — that's the entire point of oversight.
export const listAllRefunds = async (query: ListRefundsQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.status && { status: query.status }),
    ...(query.vendorId && { order: { vendorId: query.vendorId } }),
    ...(query.userId && { userId: query.userId }),
  };

  const [refunds, total] = await Promise.all([
    prisma.refundRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        items: true,
        user: { select: { id: true, fullName: true, email: true } },
        order: { select: { id: true, orderId: true, vendor: { select: { id: true, storeName: true } } } },
      },
    }),
    prisma.refundRequest.count({ where }),
  ]);

  return { refunds, meta: buildMeta(total, page, limit) };
};

export const getRefundDetail = async (id: string) => {
  const refund = await prisma.refundRequest.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true } },
      order: {
        select: {
          id: true,
          orderId: true,
          vendorId: true,
          vendor: { select: { storeName: true } },
          totalAmount: true,
        },
      },
      items: true,
    },
  });
  if (!refund) throw AppError.notFound("Refund request");
  return refund;
};

const _requireRefund = async (refundId: string) => {
  const refund = await prisma.refundRequest.findUnique({ where: { id: refundId } });
  if (!refund) throw AppError.notFound("Refund request");
  return refund;
};

export const forceApproveRefund = async (refundId: string) => {
  const refund = await _requireRefund(refundId);
  const { amountApproved } = await refundProcessing.processRefundApproval(refund);
  return { ...refund, status: "REFUNDED" as const, amountApproved };
};

export const forceDeclineRefund = async (refundId: string, reason?: string) => {
  const refund = await _requireRefund(refundId);
  await refundProcessing.processRefundDecline(refund, reason);
  return { ...refund, status: "DECLINED" as const, updateMessage: reason ?? null };
};
