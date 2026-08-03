// src/services/admin/onboarding.service.ts
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";

export const listSlides = (role?: string) =>
  prisma.onboardingSlide.findMany({
    where: role ? { role } : undefined,
    orderBy: [{ role: "asc" }, { order: "asc" }],
  });

export const getSlideById = async (id: string) => {
  const slide = await prisma.onboardingSlide.findUnique({ where: { id } });
  if (!slide) throw AppError.notFound("Onboarding slide");
  return slide;
};

export interface SlideDto {
  role: "user" | "vendor" | "rider";
  order: number;
  title: string;
  description?: string;
  bullets?: string[];
  imageUrl?: string;
  isActive?: boolean;
}

export const createSlide = (data: SlideDto) =>
  prisma.onboardingSlide.create({ data });

export const updateSlide = async (id: string, data: Partial<SlideDto>) => {
  const existing = await prisma.onboardingSlide.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Onboarding slide");
  return prisma.onboardingSlide.update({ where: { id }, data });
};

export const deleteSlide = async (id: string) => {
  const existing = await prisma.onboardingSlide.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Onboarding slide");
  await prisma.onboardingSlide.delete({ where: { id } });
};

export const reorderSlides = async (orderedIds: string[]): Promise<void> => {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.onboardingSlide.update({
        where: { id },
        data: { order: index },
      }),
    ),
  );
};
