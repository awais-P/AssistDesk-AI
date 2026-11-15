-- FR-15.5: an inbox can send a chosen canned response when a new email ticket arrives.
ALTER TABLE "Inbox" ADD COLUMN     "autoReplyTemplateId" TEXT;

ALTER TABLE "Inbox" ADD CONSTRAINT "Inbox_autoReplyTemplateId_fkey" FOREIGN KEY ("autoReplyTemplateId") REFERENCES "CannedResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The old inbox editor always saved "on" without a template, so nothing was ever sent.
-- Start every inbox switched off; admins switch it on when they pick a template.
UPDATE "Inbox" SET "autoReplyEnabled" = false;
