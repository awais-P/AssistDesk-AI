-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "aiMessageCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "clientIpHash" TEXT,
ADD COLUMN     "closedReason" TEXT,
ADD COLUMN     "contactId" TEXT,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "messageCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "previousSessionId" TEXT,
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "sessionTokenHash" TEXT,
ADD COLUMN     "summarizedMessageCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "summary" TEXT;

-- AlterTable
ALTER TABLE "Chatbot" ADD COLUMN     "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "sessionTimeoutMinutes" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "contactId" TEXT;

-- AlterTable
ALTER TABLE "WorkspaceSetting" ADD COLUMN     "crossChannelMemory" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "whatsappId" TEXT,
    "slackUserId" TEXT,
    "visitorId" TEXT,
    "memory" TEXT,
    "memoryUpdatedAt" TIMESTAMP(3),
    "lastChannel" "ChannelType",
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT,
    "contactId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Contact_workspaceId_lastSeenAt_idx" ON "Contact"("workspaceId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_workspaceId_email_key" ON "Contact"("workspaceId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_workspaceId_phone_key" ON "Contact"("workspaceId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_workspaceId_whatsappId_key" ON "Contact"("workspaceId", "whatsappId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_workspaceId_slackUserId_key" ON "Contact"("workspaceId", "slackUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_workspaceId_visitorId_key" ON "Contact"("workspaceId", "visitorId");

-- CreateIndex
CREATE INDEX "SessionEvent_workspaceId_createdAt_idx" ON "SessionEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "SessionEvent_sessionId_idx" ON "SessionEvent"("sessionId");

-- CreateIndex
CREATE INDEX "SessionEvent_contactId_idx" ON "SessionEvent"("contactId");

-- CreateIndex
CREATE INDEX "SessionEvent_type_idx" ON "SessionEvent"("type");

-- CreateIndex
CREATE INDEX "RateLimitBucket_updatedAt_idx" ON "RateLimitBucket"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_sessionTokenHash_key" ON "ChatSession"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "ChatSession_contactId_idx" ON "ChatSession"("contactId");

-- CreateIndex
CREATE INDEX "ChatSession_workspaceId_status_lastActivityAt_idx" ON "ChatSession"("workspaceId", "status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "Ticket_contactId_idx" ON "Ticket"("contactId");

-- CreateIndex
CREATE INDEX "Ticket_workspaceId_requesterEmail_idx" ON "Ticket"("workspaceId", "requesterEmail");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: existing sessions get their real last activity and message counters.
UPDATE "ChatSession" s SET
  "lastActivityAt" = COALESCE((SELECT MAX(m."createdAt") FROM "ChatMessage" m WHERE m."sessionId" = s."id"), s."updatedAt"),
  "messageCount"   = (SELECT COUNT(*) FROM "ChatMessage" m WHERE m."sessionId" = s."id"),
  "aiMessageCount" = (SELECT COUNT(*) FROM "ChatMessage" m WHERE m."sessionId" = s."id" AND m."sender" = 'AI');

-- Sessions closed before Module 5 have no recorded reason.
UPDATE "ChatSession" SET "closedReason" = 'CLOSED_BY_AGENT' WHERE "status" = 'CLOSED' AND "closedReason" IS NULL;
