-- Module 2 FE-5: store each reasoning run's chain of thought for the Action Logs.
ALTER TABLE "AgentRun" ADD COLUMN "trace" JSONB;

-- Runs are listed per ticket in the ticket view.
CREATE INDEX "AgentRun_ticketId_idx" ON "AgentRun"("ticketId");
