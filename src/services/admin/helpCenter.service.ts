// src/services/admin/helpCenter.service.ts
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";

// ── Categories ──

export const listHelpCategories = (role?: string) =>
  prisma.helpCategory.findMany({
    where: role ? { role } : undefined,
    orderBy: [{ role: "asc" }, { sortOrder: "asc" }],
    include: { articles: true },
  });

export const getHelpCategoryById = async (id: string) => {
  const category = await prisma.helpCategory.findUnique({
    where: { id },
    include: { articles: true },
  });
  if (!category) throw AppError.notFound("Help category");
  return category;
};

export interface HelpCategoryDto {
  role: string;
  label: string;
  icon?: string;
  bg?: string;
  subtitle?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export const createHelpCategory = (data: HelpCategoryDto) =>
  prisma.helpCategory.create({ data });

export const updateHelpCategory = async (
  id: string,
  data: Partial<HelpCategoryDto>,
) => {
  await getHelpCategoryById(id);
  return prisma.helpCategory.update({ where: { id }, data });
};

export const deleteHelpCategory = async (id: string) => {
  await getHelpCategoryById(id);
  await prisma.helpCategory.delete({ where: { id } });
};

// ── Articles ──

export const listHelpArticles = (categoryId?: string) =>
  prisma.helpArticle.findMany({
    where: categoryId ? { categoryId } : undefined,
    orderBy: { createdAt: "asc" },
  });

export const getHelpArticleById = async (id: string) => {
  const article = await prisma.helpArticle.findUnique({ where: { id } });
  if (!article) throw AppError.notFound("Help article");
  return article;
};

export interface HelpArticleDto {
  articleId: string;
  categoryId: string;
  role: string;
  title: string;
  sub?: string;
  popular?: boolean;
  sections: Array<{ heading: string; body: string }>;
}

export const createHelpArticle = (data: HelpArticleDto) =>
  prisma.helpArticle.create({ data: data as any });

export const updateHelpArticle = async (
  id: string,
  data: Partial<HelpArticleDto>,
) => {
  await getHelpArticleById(id);
  return prisma.helpArticle.update({ where: { id }, data: data as any });
};

export const deleteHelpArticle = async (id: string) => {
  await getHelpArticleById(id);
  await prisma.helpArticle.delete({ where: { id } });
};
