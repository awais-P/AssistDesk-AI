-- Module 9 Support Escalation: escalation records (queue, assignee, SLA, log), escalation
-- settings per workspace, sentiment per customer message, and contacts kept with the team.
-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'RESOLVED');

-- AlterTable
ALTER TABLE "WorkspaceSetting" ADD COLUMN     "escalationEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "escalationKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "escalationOnHumanRequest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "escalationSensitiveTopics" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "escalationSentimentEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "escalationSentimentThreshold" DOUBLE PRECISION NOT NULL DEFAULT -0.5,
ADD COLUMN     "escalationSlaMinutes" INTEGER NOT NULL DEFAULT 15;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "sentiment" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "aiPaused" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Escalation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT,
    "ticketId" TEXT,
    "contactId" TEXT,
    "channel" "ChannelType" NOT NULL,
    "trigger" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sentimentScore" DOUBLE PRECISION,
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "EscalationStatus" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "summaryGeneratedAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,
    "resolutionNote" TEXT,
    "slaDueAt" TIMESTAMP(3),
    "slaBreachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Escalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Escalation_workspaceId_status_createdAt_idx" ON "Escalation"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Escalation_sessionId_idx" ON "Escalation"("sessionId");

-- CreateIndex
CREATE INDEX "Escalation_ticketId_idx" ON "Escalation"("ticketId");

-- CreateIndex
CREATE INDEX "Escalation_contactId_idx" ON "Escalation"("contactId");

-- CreateIndex
CREATE INDEX "Escalation_assigneeId_idx" ON "Escalation"("assigneeId");

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

