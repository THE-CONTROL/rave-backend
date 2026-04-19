// src/services/optionGroup.service.ts
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";

export const getOptionGroups = async (vendorId: string) => {
  return prisma.optionGroup.findMany({
    where: { vendorId },
    include: {
      options: {
        include: { sizes: { orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};

export const getOptionGroupById = async (vendorId: string, id: string) => {
  const group = await prisma.optionGroup.findFirst({
    where: { id, vendorId },
    include: {
      options: {
        include: { sizes: { orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!group) throw AppError.notFound("Option group not found.");
  return group;
};

export const createOptionGroup = async (vendorId: string, data: any) => {
  const { options, ...groupData } = data;
  return prisma.optionGroup.create({
    data: {
      ...groupData,
      vendorId,
      options: options
        ? {
            create: options.map((opt: any, i: number) => ({
              name: opt.name,
              sortOrder: i,
              sizes: {
                create: (opt.sizes || []).map((s: any, j: number) => ({
                  name: s.name,
                  extraPrice: s.extraPrice ?? 0,
                  sortOrder: j,
                })),
              },
            })),
          }
        : undefined,
    },
    include: {
      options: { include: { sizes: true } },
    },
  });
};

export const updateOptionGroup = async (
  vendorId: string,
  id: string,
  data: any,
) => {
  const existing = await prisma.optionGroup.findFirst({
    where: { id, vendorId },
  });
  if (!existing) throw AppError.notFound("Option group not found.");

  const { options, ...groupData } = data;

  // Delete old options and recreate (simplest safe approach)
  await prisma.optionItem.deleteMany({ where: { groupId: id } });

  return prisma.optionGroup.update({
    where: { id },
    data: {
      ...groupData,
      options: options
        ? {
            create: options.map((opt: any, i: number) => ({
              name: opt.name,
              sortOrder: i,
              sizes: {
                create: (opt.sizes || []).map((s: any, j: number) => ({
                  name: s.name,
                  extraPrice: s.extraPrice ?? 0,
                  sortOrder: j,
                })),
              },
            })),
          }
        : undefined,
    },
    include: {
      options: { include: { sizes: true } },
    },
  });
};

export const deleteOptionGroup = async (vendorId: string, id: string) => {
  const existing = await prisma.optionGroup.findFirst({
    where: { id, vendorId },
  });
  if (!existing) throw AppError.notFound("Option group not found.");
  await prisma.optionGroup.delete({ where: { id } });
  return { deleted: true };
};
