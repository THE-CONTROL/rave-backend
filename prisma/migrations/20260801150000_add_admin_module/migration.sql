-- AlterEnum: add the "admin" role. Postgres requires ADD VALUE to run outside
-- an explicit transaction block — apply this statement on its own if your
-- migration runner wraps files in BEGIN/COMMIT.
ALTER TYPE "Role" ADD VALUE 'admin';

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('super_admin', 'support', 'ops', 'finance', 'content');

-- CreateTable: one profile per admin User, mirroring VendorProfile/RiderProfile.
CREATE TABLE "admin_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adminRole" "AdminRole" NOT NULL DEFAULT 'support',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_profiles_userId_key" ON "admin_profiles"("userId");

ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: generic audit trail for every admin mutation.
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_adminId_idx" ON "audit_logs"("adminId");
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
