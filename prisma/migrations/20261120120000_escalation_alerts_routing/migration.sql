-- Module 9: escalation alerts by email and Slack, and round-robin routing.
ALTER TABLE "WorkspaceSetting" ADD COLUMN "escalationNotifyEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "WorkspaceSetting" ADD COLUMN "escalationSlackWebhookUrl" TEXT;
ALTER TABLE "WorkspaceSetting" ADD COLUMN "escalationAlertUrgentOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkspaceSetting" ADD COLUMN "escalationRouting" TEXT NOT NULL DEFAULT 'QUEUE';
ALTER TABLE "WorkspaceSetting" ADD COLUMN "escalationRoutingUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "WorkspaceSetting" ADD COLUMN "escalationRoutingOnlineOnly" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WorkspaceSetting" ADD COLUMN "escalationLastRoutedUserId" TEXT;
