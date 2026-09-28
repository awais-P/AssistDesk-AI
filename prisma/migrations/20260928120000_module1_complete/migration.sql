-- DropForeignKey
ALTER TABLE "Chatbot" DROP CONSTRAINT "Chatbot_agentId_fkey";

-- AlterTable
ALTER TABLE "AIAgent" ADD COLUMN     "maxTokens" INTEGER NOT NULL DEFAULT 512,
ADD COLUMN     "responseLength" TEXT NOT NULL DEFAULT 'BALANCED',
ADD COLUMN     "tone" TEXT NOT NULL DEFAULT 'FRIENDLY';

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "attachments" JSONB,
ADD COLUMN     "authorName" TEXT,
ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "integrationId" TEXT;

-- AlterTable
ALTER TABLE "Chatbot" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "conversationStarters" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "fallbackDelaySeconds" INTEGER NOT NULL DEFAULT 60;

-- AlterTable
ALTER TABLE "Inbox" ADD COLUMN     "senderName" TEXT,
ADD COLUMN     "smtpHost" TEXT,
ADD COLUMN     "smtpPassword" TEXT,
ADD COLUMN     "smtpPort" INTEGER,
ADD COLUMN     "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "smtpUser" TEXT;

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "statusMessage" TEXT;

-- AlterTable
ALTER TABLE "KnowledgeSource" ADD COLUMN     "crawlMode" TEXT NOT NULL DEFAULT 'SINGLE',
ADD COLUMN     "maxPages" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "pageCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TicketMessage" ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryStatus" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_externalId_key" ON "ChatMessage"("externalId");

-- CreateIndex
CREATE INDEX "ChatSession_integrationId_externalId_idx" ON "ChatSession"("integrationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_type_externalId_key" ON "Integration"("type", "externalId");

-- AddForeignKey
ALTER TABLE "Chatbot" ADD CONSTRAINT "Chatbot_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data fix: agents saved as "Groq" without their own key could never call a model.
-- Move them to the managed Default provider (Groq first, with automatic failover).
UPDATE "AIAgent"
SET "provider" = 'Default', "model" = 'groq/' || "model"
WHERE "provider" = 'Groq' AND "apiKey" IS NULL
  AND "model" IN ('llama-3.3-70b-versatile', 'llama-3.1-8b-instant');
