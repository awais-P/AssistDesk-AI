import { loadLead } from "./leads";
import { prisma } from "./prisma";

/**
 * One lead with its timeline, webhook deliveries, conversation excerpt and the same
 * customer's other leads. Shared by the lead detail page and GET /api/leads/[id].
 */
export async function loadLeadDetail(workspaceId: string, leadId: string) {
  const lead = await loadLead(workspaceId, leadId);

  if (!lead) {
    return null;
  }

  const [events, deliveries, messages, otherLeads] = await Promise.all([
    prisma.leadEvent.findMany({
      where: { leadId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, type: true, detail: true, actorName: true, createdAt: true },
    }),
    prisma.webhookDelivery.findMany({
      where: { leadId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        event: true,
        status: true,
        attempts: true,
        responseStatus: true,
        error: true,
        nextAttemptAt: true,
        deliveredAt: true,
        createdAt: true,
        endpoint: { select: { id: true, name: true } },
      },
    }),
    lead.session
      ? prisma.chatMessage.findMany({
          where: { sessionId: lead.session.id, sender: { in: ["USER", "AI", "AGENT"] } },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, sender: true, content: true, authorName: true, createdAt: true },
        })
      : Promise.resolve([]),
    lead.contact
      ? prisma.lead.findMany({
          where: { contactId: lead.contact.id, id: { not: leadId } },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, status: true, createdAt: true, intent: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    lead,
    events: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
    deliveries: deliveries.map((delivery) => ({
      ...delivery,
      nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
      deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      createdAt: delivery.createdAt.toISOString(),
    })),
    conversation: messages
      .reverse()
      .map((message) => ({ ...message, createdAt: message.createdAt.toISOString() })),
    otherLeads: otherLeads.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
  };
}

export type LeadDetail = NonNullable<Awaited<ReturnType<typeof loadLeadDetail>>>;
