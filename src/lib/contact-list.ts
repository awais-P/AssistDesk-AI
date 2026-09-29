import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";

/**
 * Customer directory for the dashboard (Module 5 Unified Memory Buffer). Shared by
 * the Contacts pages (server render) and GET /api/contacts, /api/contacts/[id]
 * (live refresh), so both always return the same shape.
 */

export type ContactListItem = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  identifiers: {
    whatsapp: boolean;
    slack: boolean;
    webVisitor: boolean;
  };
  hasMemory: boolean;
  lastChannel: string | null;
  channels: string[];
  openSessions: number;
  sessionCount: number;
  ticketCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type ContactListResult = {
  total: number;
  contacts: ContactListItem[];
};

export type ContactDetail = {
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    identifiers: {
      email: boolean;
      phone: boolean;
      whatsapp: boolean;
      slack: boolean;
      webVisitor: boolean;
    };
    memory: string | null;
    memoryUpdatedAt: string | null;
    lastChannel: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
  };
  sessions: Array<{
    id: string;
    channel: string;
    status: string;
    startedAt: string;
    lastActivityAt: string;
    endedAt: string | null;
    closedReason: string | null;
    resolution: string | null;
    summary: string | null;
    messageCount: number;
    previousSessionId: string | null;
    source: string | null;
  }>;
  tickets: Array<{
    id: string;
    reference: string;
    ticketNumber: number;
    subject: string;
    status: string;
    priority: string;
    source: string;
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    type: string;
    detail: string | null;
    sessionId: string | null;
    createdAt: string;
  }>;
};

/** `query` searches name, email and phone; `take` is clamped to 1..100 (default 50). */
export async function loadContactList(
  workspaceId: string,
  options: { query?: string | null; take?: number } = {},
): Promise<ContactListResult> {
  const query = options.query?.trim().slice(0, 120);
  const take = Math.min(100, Math.max(1, Math.floor(options.take ?? 0) || 50));
  const where: Prisma.ContactWhereInput = { workspaceId };

  if (query) {
    const contains = { contains: query, mode: "insensitive" as const };
    where.OR = [{ name: contains }, { email: contains }, { phone: contains }];
  }

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      take,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        whatsappId: true,
        slackUserId: true,
        visitorId: true,
        memory: true,
        lastChannel: true,
        firstSeenAt: true,
        lastSeenAt: true,
        sessions: { select: { channel: true, status: true }, take: 50 },
        _count: { select: { sessions: true, tickets: true } },
      },
    }),
    prisma.contact.count({ where }),
  ]);

  return {
    total,
    contacts: contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      identifiers: {
        whatsapp: Boolean(contact.whatsappId),
        slack: Boolean(contact.slackUserId),
        webVisitor: Boolean(contact.visitorId),
      },
      hasMemory: Boolean(contact.memory),
      lastChannel: contact.lastChannel,
      channels: [...new Set(contact.sessions.map((item) => item.channel))],
      openSessions: contact.sessions.filter((item) => item.status !== "CLOSED").length,
      sessionCount: contact._count.sessions,
      ticketCount: contact._count.tickets,
      firstSeenAt: contact.firstSeenAt.toISOString(),
      lastSeenAt: contact.lastSeenAt.toISOString(),
    })),
  };
}

/** One customer's cross-channel history, or null when they are not in this workspace. */
export async function loadContactDetail(
  workspaceId: string,
  id: string,
): Promise<ContactDetail | null> {
  const contact = await prisma.contact.findFirst({
    where: { id, workspaceId },
    include: {
      sessions: {
        orderBy: { startedAt: "desc" },
        take: 50,
        select: {
          id: true,
          channel: true,
          status: true,
          startedAt: true,
          lastActivityAt: true,
          endedAt: true,
          closedReason: true,
          resolution: true,
          summary: true,
          messageCount: true,
          previousSessionId: true,
          chatbot: { select: { name: true } },
          integration: { select: { name: true } },
        },
      },
      tickets: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          ticketNumber: true,
          subject: true,
          status: true,
          priority: true,
          source: true,
          createdAt: true,
          inbox: { select: { ticketPrefix: true } },
        },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, type: true, detail: true, sessionId: true, createdAt: true },
      },
    },
  });

  if (!contact) {
    return null;
  }

  return {
    contact: {
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
      lastChannel: contact.lastChannel,
      firstSeenAt: contact.firstSeenAt.toISOString(),
      lastSeenAt: contact.lastSeenAt.toISOString(),
    },
    sessions: contact.sessions.map((item) => ({
      id: item.id,
      channel: item.channel,
      status: item.status,
      startedAt: item.startedAt.toISOString(),
      lastActivityAt: item.lastActivityAt.toISOString(),
      endedAt: item.endedAt?.toISOString() ?? null,
      closedReason: item.closedReason,
      resolution: item.resolution,
      summary: item.summary,
      messageCount: item.messageCount,
      previousSessionId: item.previousSessionId,
      source: item.chatbot?.name ?? item.integration?.name ?? null,
    })),
    tickets: contact.tickets.map((ticket) => ({
      id: ticket.id,
      reference: `${ticket.inbox?.ticketPrefix ?? "AD"}-${ticket.ticketNumber}`,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      source: ticket.source,
      createdAt: ticket.createdAt.toISOString(),
    })),
    events: contact.events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  };
}
