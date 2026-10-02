import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { getIdleTimeoutMinutes, getSessionExpiresAt } from "@/src/lib/session-lifecycle";
import { buildCustomerContext } from "@/src/lib/session-memory";

type ChatSessionContextRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/**
 * Everything the dashboard shows beside a conversation (Module 5): the customer
 * (Contact) and their channels, the session policy and expiry, the session summary,
 * the customer's other conversations and tickets, the session's audit trail, and the
 * exact memory block the AI receives for its next reply.
 */
export async function GET(_request: Request, context: ChatSessionContextRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const chatSession = await prisma.chatSession.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    include: {
      chatbot: { select: { name: true, sessionTimeoutMinutes: true, rateLimitPerMinute: true } },
      integration: { select: { name: true, type: true } },
      events: {
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, type: true, detail: true, createdAt: true },
      },
      contact: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          whatsappId: true,
          slackUserId: true,
          visitorId: true,
          memory: true,
          memoryUpdatedAt: true,
          firstSeenAt: true,
          lastSeenAt: true,
          lastChannel: true,
        },
      },
    },
  });

  if (!chatSession) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const contactId = chatSession.contactId;
  const [otherSessions, tickets, aiContext, workspaceSettings, lead] = await Promise.all([
    contactId
      ? prisma.chatSession.findMany({
          where: { contactId, id: { not: chatSession.id } },
          orderBy: { lastActivityAt: "desc" },
          take: 10,
          select: {
            id: true,
            channel: true,
            status: true,
            startedAt: true,
            lastActivityAt: true,
            closedReason: true,
            resolution: true,
            summary: true,
            messageCount: true,
          },
        })
      : Promise.resolve([]),
    contactId
      ? prisma.ticket.findMany({
          where: { contactId },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, ticketNumber: true, subject: true, status: true, createdAt: true, source: true },
        })
      : Promise.resolve([]),
    buildCustomerContext(chatSession.id),
    prisma.workspaceSetting.findUnique({
      where: { workspaceId: session.user.workspaceId },
      select: { crossChannelMemory: true },
    }),
    // Module 8: this conversation's lead, or the customer's latest one.
    prisma.lead.findFirst({
      where: {
        workspaceId: session.user.workspaceId,
        OR: [{ sessionId: chatSession.id }, ...(contactId ? [{ contactId }] : [])],
      },
      orderBy: { lastActivityAt: "desc" },
      select: { id: true, status: true, score: true, source: true, intent: true, createdAt: true },
    }),
  ]);

  const contact = chatSession.contact;
  const channels = [
    ...new Set([
      chatSession.channel,
      ...otherSessions.map((item) => item.channel),
      ...tickets.filter((ticket) => ticket.source === "EMAIL").map(() => "EMAIL" as const),
    ]),
  ];

  return NextResponse.json({
    session: {
      id: chatSession.id,
      channel: chatSession.channel,
      status: chatSession.status,
      startedAt: chatSession.startedAt.toISOString(),
      lastActivityAt: chatSession.lastActivityAt.toISOString(),
      endedAt: chatSession.endedAt?.toISOString() ?? null,
      expiresAt: getSessionExpiresAt(chatSession)?.toISOString() ?? null,
      idleTimeoutMinutes: getIdleTimeoutMinutes(chatSession),
      closedReason: chatSession.closedReason,
      resolution: chatSession.resolution,
      summary: chatSession.summary,
      messageCount: chatSession.messageCount,
      aiMessageCount: chatSession.aiMessageCount,
      previousSessionId: chatSession.previousSessionId,
      rateLimitPerMinute: chatSession.chatbot?.rateLimitPerMinute ?? null,
      source: chatSession.chatbot?.name ?? chatSession.integration?.name ?? null,
    },
    contact: contact
      ? {
          id: contact.id,
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          identifiers: {
            email: Boolean(contact.email),
            phone: Boolean(contact.phone),
            whatsapp: Boolean(contact.whatsappId),
            slack: Boolean(contact.slackUserId),
            webVisitor: Boolean(contact.visitorId),
          },
          memory: contact.memory,
          memoryUpdatedAt: contact.memoryUpdatedAt?.toISOString() ?? null,
          firstSeenAt: contact.firstSeenAt.toISOString(),
          lastSeenAt: contact.lastSeenAt.toISOString(),
          channels,
        }
      : null,
    crossChannelMemory: workspaceSettings?.crossChannelMemory !== false,
    lead: lead ? { ...lead, createdAt: lead.createdAt.toISOString() } : null,
    leadState: chatSession.leadState,
    aiContext: aiContext.text,
    otherSessions: otherSessions.map((item) => ({
      ...item,
      startedAt: item.startedAt.toISOString(),
      lastActivityAt: item.lastActivityAt.toISOString(),
    })),
    tickets: tickets.map((ticket) => ({ ...ticket, createdAt: ticket.createdAt.toISOString() })),
    events: chatSession.events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  });
}
