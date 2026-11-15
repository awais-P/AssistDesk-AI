-- CreateIndex
CREATE INDEX "AIAgent_workspaceId_createdAt_idx" ON "AIAgent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AIAgent_workspaceId_status_idx" ON "AIAgent"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeSource_workspaceId_createdAt_idx" ON "KnowledgeSource"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeSource_workspaceId_status_idx" ON "KnowledgeSource"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Ticket_workspaceId_createdAt_idx" ON "Ticket"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_workspaceId_status_createdAt_idx" ON "Ticket"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_workspaceId_priority_createdAt_idx" ON "Ticket"("workspaceId", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "ChatSession_workspaceId_startedAt_idx" ON "ChatSession"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "ChatSession_workspaceId_status_updatedAt_idx" ON "ChatSession"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "AutomationLog_workspaceId_createdAt_idx" ON "AutomationLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationLog_workspaceId_action_createdAt_idx" ON "AutomationLog"("workspaceId", "action", "createdAt");
