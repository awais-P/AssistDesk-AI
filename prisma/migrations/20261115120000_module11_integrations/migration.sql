-- Module 11: Integrations & System Customization (audit log, API keys, connectors, custom roles).
-- The old placeholder ApiKey table was never used; its rows (none expected) cannot become real keys.
DELETE FROM "ApiKey";

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'API_KEY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConnectorProvider" AS ENUM ('HUBSPOT', 'SHOPIFY');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('CONNECTED', 'ERROR', 'DISCONNECTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "customRoleId" TEXT;

-- AlterTable
ALTER TABLE "ApiKey" DROP COLUMN "isActive",
DROP COLUMN "keyPreview",
DROP COLUMN "provider",
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "keyHash" TEXT NOT NULL,
ADD COLUMN     "lastUsedIpHash" TEXT,
ADD COLUMN     "prefix" TEXT NOT NULL,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "scopes" TEXT[],
ADD COLUMN     "usageCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "crmId" TEXT,
ADD COLUMN     "crmSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL DEFAULT 'USER',
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "targetType" TEXT,
    "targetId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "ConnectorProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'CONNECTED',
    "config" JSONB,
    "secret" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "syncedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomRole" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseRole" "UserRole" NOT NULL,
    "permissions" TEXT[],
    "deniedPermissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_category_createdAt_idx" ON "AuditLog"("workspaceId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_actorId_idx" ON "AuditLog"("workspaceId", "actorId");

-- CreateIndex
CREATE UNIQUE INDEX "Connector_workspaceId_provider_key" ON "Connector"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_workspaceId_name_key" ON "CustomRole"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "User_customRoleId_idx" ON "User"("customRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRole" ADD CONSTRAINT "CustomRole_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The audit log is append-only: entries can never be changed (rows go only with their workspace).
CREATE OR REPLACE FUNCTION "audit_log_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog entries cannot be changed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_no_update" BEFORE UPDATE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "audit_log_append_only"();
