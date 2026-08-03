// src/services/admin/catalogAdmin.service.ts
//
// Cross-vendor, read-only browsing of catalog data (menu items + option
// groups). None of this existed in the admin surface before — a vendor's
// products/customization config were invisible outside their own dashboard.
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";

export interface ListMenuItemsQuery extends PaginationQuery {
  vendorId?: string;
  search?: string;
  isActive?: boolean;
}

export const listMenuItems = async (query: ListMenuItemsQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.vendorId && { vendorId: query.vendorId }),
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...(query.search && {
      name: { contains: query.search, mode: "insensitive" as const },
    }),
  };

  const [items, total] = await Promise.all([
    prisma.menuItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        vendor: { select: { id: true, storeName: true } },
        images: true,
      },
    }),
    prisma.menuItem.count({ where }),
  ]);

  return { items, meta: buildMeta(total, page, limit) };
};

export const getMenuItemDetail = async (id: string) => {
  const item = await prisma.menuItem.findUnique({
    where: { id },
    include: {
      vendor: { select: { id: true, storeName: true } },
      images: true,
      ingredients: true,
      categories: { include: { category: true } },
      optionGroups: { include: { options: { include: { sizes: true } } } },
    },
  });
  if (!item) throw AppError.notFound("Menu item");
  return item;
};

export interface ListOptionGroupsQuery extends PaginationQuery {
  vendorId?: string;
}

export const listOptionGroups = async (query: ListOptionGroupsQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = { ...(query.vendorId && { vendorId: query.vendorId }) };

  const [groups, total] = await Promise.all([
    prisma.optionGroup.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        vendor: { select: { id: true, storeName: true } },
        options: { include: { sizes: true } },
      },
    }),
    prisma.optionGroup.count({ where }),
  ]);

  return { groups, meta: buildMeta(total, page, limit) };
};
