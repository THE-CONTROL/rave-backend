// src/services/admin/legal.service.ts
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";

export interface ListLegalDocsQuery {
  slug?: string;
  role?: string;
  includeHistory?: boolean;
}

// LegalDocument.createdBy is a raw userId (no relation), so list results are
// annotated with the admin's name via a batched lookup instead of an include.
const withCreatedByNames = async <T extends { createdBy: string | null }>(
  docs: T[],
): Promise<(T & { createdByName: string | null })[]> => {
  const creatorIds = docs.map((d) => d.createdBy).filter((id): id is string => !!id);
  const creators = await prisma.user.findMany({
    where: { id: { in: creatorIds } },
    select: { id: true, fullName: true },
  });
  const byId = new Map(creators.map((u) => [u.id, u]));

  return docs.map((d) => ({
    ...d,
    createdByName: d.createdBy ? (byId.get(d.createdBy)?.fullName ?? null) : null,
  }));
};

export const listLegalDocs = async (query: ListLegalDocsQuery) => {
  const docs = await prisma.legalDocument.findMany({
    where: {
      ...(query.slug && { slug: query.slug }),
      ...(query.role && { role: query.role }),
      ...(!query.includeHistory && { isActive: true }),
    },
    orderBy: [{ slug: "asc" }, { role: "asc" }, { version: "desc" }],
  });
  return withCreatedByNames(docs);
};

export const getLegalDocVersion = async (id: string) => {
  const doc = await prisma.legalDocument.findUnique({ where: { id } });
  if (!doc) throw AppError.notFound("Legal document");
  return doc;
};

export const getVersionHistory = async (slug: string, role: string) => {
  const docs = await prisma.legalDocument.findMany({
    where: { slug, role },
    orderBy: { version: "desc" },
  });
  return withCreatedByNames(docs);
};

export interface LegalDocContent {
  lastUpdated: string;
  intro: string;
  sections: Array<{ heading: string; body: string }>;
}

/** First version for a (slug, role) pair that doesn't exist yet. */
export const createLegalDoc = async (
  slug: string,
  role: string,
  content: LegalDocContent,
  adminId: string,
) => {
  const existing = await prisma.legalDocument.findFirst({ where: { slug, role } });
  if (existing) {
    throw AppError.conflict(
      "A document with this slug/role already exists — publish a new version instead.",
    );
  }

  return prisma.legalDocument.create({
    data: {
      slug,
      role,
      ...content,
      version: 1,
      isActive: true,
      publishedAt: new Date(),
      createdBy: adminId,
    },
  });
};

/**
 * Publishes a new version: deactivates the current active row and inserts a
 * new one at version+1, in a single transaction. History is preserved.
 */
export const publishNewVersion = async (
  slug: string,
  role: string,
  content: LegalDocContent,
  adminId: string,
) => {
  const current = await prisma.legalDocument.findFirst({
    where: { slug, role, isActive: true },
  });
  if (!current) {
    throw AppError.notFound(
      "No existing document for this slug/role — create it first.",
    );
  }

  const [, created] = await prisma.$transaction([
    prisma.legalDocument.update({
      where: { id: current.id },
      data: { isActive: false },
    }),
    prisma.legalDocument.create({
      data: {
        slug,
        role,
        ...content,
        version: current.version + 1,
        isActive: true,
        publishedAt: new Date(),
        createdBy: adminId,
      },
    }),
  ]);

  return created;
};

/** Only allowed on a version that was never published as the active one. */
export const deleteLegalDoc = async (id: string) => {
  const doc = await prisma.legalDocument.findUnique({ where: { id } });
  if (!doc) throw AppError.notFound("Legal document");
  if (doc.isActive) {
    throw AppError.badRequest(
      "Cannot delete the currently published version. Publish a new version first.",
    );
  }
  await prisma.legalDocument.delete({ where: { id } });
};
