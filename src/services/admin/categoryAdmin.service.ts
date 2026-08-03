// src/services/admin/categoryAdmin.service.ts
//
// Categories are vendor-scoped in the current schema (Category.vendorId is
// required) — admins get list/moderate (deactivate a spam/inappropriate
// category platform-wide) rather than full ownership. See plan decision.
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";

export interface ListCategoriesQuery extends PaginationQuery {
  vendorId?: string;
  search?: string;
}

export const listAllCategories = async (query: ListCategoriesQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.vendorId && { vendorId: query.vendorId }),
    ...(query.search && {
      name: { contains: query.search, mode: "insensitive" as const },
    }),
  };

  const [categories, total] = await Promise.all([
    prisma.category.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { vendor: { select: { id: true, storeName: true } } },
    }),
    prisma.category.count({ where }),
  ]);

  return { categories, meta: buildMeta(total, page, limit) };
};

export const toggleCategoryActive = async (id: string, isActive: boolean) => {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Category");
  return prisma.category.update({ where: { id }, data: { isActive } });
};
