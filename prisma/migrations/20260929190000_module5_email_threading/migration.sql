-- Module 5: email replies thread into their ticket; provider retries are deduplicated.
ALTER TABLE "TicketMessage" ADD COLUMN "externalId" TEXT;

CREATE UNIQUE INDEX "TicketMessage_externalId_key" ON "TicketMessage"("externalId");
