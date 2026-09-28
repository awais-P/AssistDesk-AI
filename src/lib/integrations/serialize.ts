import type { Prisma } from "@/app/generated/prisma/client";
import { maskIntegrationConfig } from "./config";

export const integrationInclude = {
  inbox: { select: { id: true, name: true, emailPrefix: true } },
  agent: { select: { id: true, name: true, status: true } },
} as const;

type IntegrationWithRelations = Prisma.IntegrationGetPayload<{
  include: typeof integrationInclude;
}>;

export function serializeIntegration(integration: IntegrationWithRelations) {
  return {
    id: integration.id,
    type: integration.type,
    name: integration.name,
    provider: integration.provider,
    status: integration.status,
    statusMessage: integration.statusMessage,
    externalId: integration.externalId,
    supportAddress: integration.supportAddress,
    forwardingAddress: integration.forwardingAddress,
    // WhatsApp needs its verify token pasted into Meta; email needs its webhook secret.
    webhookSecret: integration.webhookSecret,
    config: maskIntegrationConfig(integration.type, integration.config),
    isActive: integration.isActive,
    lastSyncedAt: integration.lastSyncedAt?.toISOString() ?? null,
    inboxId: integration.inboxId,
    agentId: integration.agentId,
    inbox: integration.inbox,
    agent: integration.agent,
    createdAt: integration.createdAt.toISOString(),
  };
}

