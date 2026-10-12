import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";
import { WEBHOOK_EVENTS, maskWebhookSecret } from "./webhooks";

/** Shared helpers for the webhook settings API (Module 8 FE-4). */

export const MAX_WEBHOOKS_PER_WORKSPACE = 10;

const endpointSelect = {
  id: true,
  name: true,
  url: true,
  secret: true,
  events: true,
  isActive: true,
  lastDeliveryAt: true,
  lastStatus: true,
  createdAt: true,
} satisfies Prisma.WebhookEndpointSelect;

type EndpointRow = Prisma.WebhookEndpointGetPayload<{ select: typeof endpointSelect }>;

export function serializeEndpoint(endpoint: EndpointRow, stats?: { success: number; failed: number; pending: number }) {
  return {
    id: endpoint.id,
    name: endpoint.name,
    url: endpoint.url,
    secretPreview: maskWebhookSecret(endpoint.secret),
    events: endpoint.events,
    isActive: endpoint.isActive,
    lastDeliveryAt: endpoint.lastDeliveryAt?.toISOString() ?? null,
    lastStatus: endpoint.lastStatus,
    createdAt: endpoint.createdAt.toISOString(),
    stats: stats ?? { success: 0, failed: 0, pending: 0 },
  };
}

export async function loadEndpoints(workspaceId: string) {
  const [endpoints, grouped] = await Promise.all([
    prisma.webhookEndpoint.findMany({ where: { workspaceId }, select: endpointSelect, orderBy: { createdAt: "asc" } }),
    prisma.webhookDelivery.groupBy({
      by: ["endpointId", "status"],
      where: { workspaceId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      _count: { _all: true },
    }),
  ]);

  return endpoints.map((endpoint) => {
    const stats = { success: 0, failed: 0, pending: 0 };

    for (const group of grouped.filter((item) => item.endpointId === endpoint.id)) {
      if (group.status === "SUCCESS") stats.success += group._count._all;
      else if (group.status === "FAILED") stats.failed += group._count._all;
      else stats.pending += group._count._all;
    }

    return serializeEndpoint(endpoint, stats);
  });
}

export async function loadEndpoint(workspaceId: string, id: string) {
  return prisma.webhookEndpoint.findFirst({ where: { id, workspaceId }, select: endpointSelect });
}

export function parseEvents(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const events = [...new Set(value.filter((item): item is string => typeof item === "string"))];

  return events.length > 0 && events.every((event) => (WEBHOOK_EVENTS as readonly string[]).includes(event))
    ? events
    : null;
}
