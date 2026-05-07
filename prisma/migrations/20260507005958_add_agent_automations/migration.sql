-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('INCOMING', 'SCHEDULED');

-- CreateTable
CREATE TABLE "AgentAutomation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "triggerType" "AutomationTrigger" NOT NULL,
    "summary" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentAutomation_workspaceId_idx" ON "AgentAutomation"("workspaceId");

-- CreateIndex
CREATE INDEX "AgentAutomation_agentId_idx" ON "AgentAutomation"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentAutomation_agentId_key_key" ON "AgentAutomation"("agentId", "key");

-- AddForeignKey
ALTER TABLE "AgentAutomation" ADD CONSTRAINT "AgentAutomation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAutomation" ADD CONSTRAINT "AgentAutomation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
