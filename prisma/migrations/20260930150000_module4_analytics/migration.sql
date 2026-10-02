-- Module 4: analytics store (AiInteraction) and reply feedback (MessageFeedback, Module 6 FE-3).
-- CreateTable
CREATE TABLE "AiInteraction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT,
    "chatbotId" TEXT,
    "sessionId" TEXT,
    "ticketId" TEXT,
    "messageId" TEXT,
    "channel" "ChannelType" NOT NULL,
    "question" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "provider" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grounded" BOOLEAN NOT NULL DEFAULT false,
    "usedFallback" BOOLEAN NOT NULL DEFAULT false,
    "sourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageFeedback" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiInteraction_messageId_key" ON "AiInteraction"("messageId");

-- CreateIndex
CREATE INDEX "AiInteraction_workspaceId_createdAt_idx" ON "AiInteraction"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AiInteraction_workspaceId_grounded_createdAt_idx" ON "AiInteraction"("workspaceId", "grounded", "createdAt");

-- CreateIndex
CREATE INDEX "AiInteraction_sessionId_idx" ON "AiInteraction"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageFeedback_messageId_key" ON "MessageFeedback"("messageId");

-- CreateIndex
CREATE INDEX "MessageFeedback_workspaceId_createdAt_idx" ON "MessageFeedback"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageFeedback_sessionId_idx" ON "MessageFeedback"("sessionId");

-- AddForeignKey
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageFeedback" ADD CONSTRAINT "MessageFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageFeedback" ADD CONSTRAINT "MessageFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

