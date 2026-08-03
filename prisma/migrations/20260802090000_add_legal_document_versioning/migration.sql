-- AlterTable: version legal documents instead of overwriting in place.
-- Existing rows all get version=1, which trivially satisfies the new
-- composite unique constraint since there was previously only one row per
-- (slug, role).
ALTER TABLE "legal_documents" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "legal_documents" ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "legal_documents" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "legal_documents" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- DropIndex / CreateIndex: replace the old (slug, role) unique constraint —
-- multiple versions now legitimately share (slug, role).
DROP INDEX "legal_documents_slug_role_key";
CREATE UNIQUE INDEX "legal_documents_slug_role_version_key" ON "legal_documents"("slug", "role", "version");
CREATE INDEX "legal_documents_slug_role_isActive_idx" ON "legal_documents"("slug", "role", "isActive");
