// src/services/admin/promotionAdmin.service.ts
//
// Promotions are self-service (vendors create/edit their own), but had zero
// admin oversight — no way to see or shut down an abusive promo code
// platform-wide without DB access.
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";

export interface ListPromotionsQuery extends PaginationQuery {
  vendorId?: string;
  isActive?: boolean;
  search?: string;
}

export const listAllPromotions = async (query: ListPromotionsQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.vendorId && { vendorId: query.vendorId }),
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...(query.search && {
      OR: [
        { title: { contains: query.search, mode: "insensitive" as const } },
        { promoCode: { contains: query.search, mode: "insensitive" as const } },
      ],
    }),
  };

  const [promotions, total] = await Promise.all([
    prisma.promotion.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { vendor: { select: { id: true, storeName: true } } },
    }),
    prisma.promotion.count({ where }),
  ]);

  return { promotions, meta: buildMeta(total, page, limit) };
};

export const getPromotionDetail = async (id: string) => {
  const promotion = await prisma.promotion.findUnique({
    where: { id },
    include: { vendor: { select: { id: true, storeName: true } } },
  });
  if (!promotion) throw AppError.notFound("Promotion");
  return promotion;
};

export const deactivatePromotion = async (id: string) => {
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Promotion");
  if (!existing.isActive) throw AppError.badRequest("Promotion is already inactive.");
  return prisma.promotion.update({ where: { id }, data: { isActive: false } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Create/update/delete — admin authoring a promotion on behalf of a vendor.
// `Promotion.vendorId` is required by the schema (a promo always belongs to
// exactly one vendor's catalog), so the admin picks the vendor explicitly
// rather than there being a "platform-wide" promo concept. Unlike the
// vendor's own self-service create/update in vendor.service.ts, this
// validates promoCode uniqueness with a clean error (not a raw Prisma P2002)
// and verifies productIds actually belong to the selected vendor.
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminCreatePromotionDto {
  vendorId: string;
  title: string;
  subtitle?: string;
  type: string;
  startDate: Date;
  endDate: Date;
  description?: string;
  discountValue?: number;
  promoCode?: string;
  minimumOrder?: number;
  maxUses?: number;
  appliesTo: "all" | "specific";
  productIds?: string[];
}

const _assertProductsOwnedByVendor = async (
  vendorId: string,
  productIds: string[],
) => {
  if (productIds.length === 0) return;
  const ownedCount = await prisma.menuItem.count({
    where: { id: { in: productIds }, vendorId },
  });
  if (ownedCount !== productIds.length) {
    throw AppError.badRequest(
      "One or more products don't belong to this vendor's menu.",
    );
  }
};

const _assertPromoCodeFree = async (promoCode: string, excludeId?: string) => {
  const existing = await prisma.promotion.findUnique({ where: { promoCode } });
  if (existing && existing.id !== excludeId) {
    throw AppError.conflict("This promo code is already in use.");
  }
};

export const createPromotion = async (data: AdminCreatePromotionDto) => {
  const vendor = await prisma.vendorProfile.findUnique({ where: { id: data.vendorId } });
  if (!vendor) throw AppError.notFound("Vendor");

  if (data.promoCode) await _assertPromoCodeFree(data.promoCode);

  const productIds = data.appliesTo === "all" ? [] : (data.productIds ?? []);
  await _assertProductsOwnedByVendor(data.vendorId, productIds);

  return prisma.promotion.create({ data: { ...data, productIds } });
};

export interface AdminUpdatePromotionDto {
  title?: string;
  subtitle?: string;
  isActive?: boolean;
  startDate?: Date;
  endDate?: Date;
  description?: string;
  discountValue?: number;
  promoCode?: string;
  minimumOrder?: number;
  maxUses?: number;
  appliesTo?: "all" | "specific";
  productIds?: string[];
}

export const updatePromotion = async (id: string, data: AdminUpdatePromotionDto) => {
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Promotion");

  if (data.promoCode) await _assertPromoCodeFree(data.promoCode, id);

  let productIds = data.productIds;
  if (data.appliesTo === "all") {
    productIds = [];
  } else if (productIds && productIds.length > 0) {
    await _assertProductsOwnedByVendor(existing.vendorId, productIds);
  }

  const effectiveStart = data.startDate ?? existing.startDate;
  const effectiveEnd = data.endDate ?? existing.endDate;
  if (effectiveEnd <= effectiveStart) {
    throw AppError.badRequest("End date must be after start date");
  }

  return prisma.promotion.update({
    where: { id },
    data: { ...data, ...(productIds !== undefined && { productIds }) },
  });
};

export const deletePromotion = async (id: string) => {
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Promotion");
  if (existing.timesUsed > 0) {
    throw AppError.badRequest(
      "This promotion has already been used — deactivate it instead of deleting.",
    );
  }
  await prisma.promotion.delete({ where: { id } });
};
