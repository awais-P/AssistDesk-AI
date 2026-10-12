-- Module 5: remember which browser a website session came from (memory trust level).
ALTER TABLE "ChatSession" ADD COLUMN "visitorId" TEXT;
