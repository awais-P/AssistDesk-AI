-- CreateEnum
CREATE TYPE "ChatbotReplyMode" AS ENUM ('ALWAYS', 'OPERATOR_OFFLINE', 'FALLBACK');

-- CreateEnum
CREATE TYPE "WidgetPosition" AS ENUM ('BOTTOM_RIGHT', 'BOTTOM_LEFT');

-- AlterTable
ALTER TABLE "Chatbot"
ADD COLUMN "aiRepliesEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "replyMode" "ChatbotReplyMode" NOT NULL DEFAULT 'ALWAYS',
ADD COLUMN "additionalPrompt" TEXT,
ADD COLUMN "widgetPosition" "WidgetPosition" NOT NULL DEFAULT 'BOTTOM_RIGHT',
ADD COLUMN "requireName" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requireEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "requirePhone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ChatSession"
ADD COLUMN "customerPhone" TEXT;
