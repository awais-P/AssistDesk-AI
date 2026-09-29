import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";
import { getIdleTimeoutMinutes, getSessionExpiresAt } from "./session-lifecycle";

/**
 * Chat session list for the dashboard (Module 5 FE-4 session history). Shared by
 * the Chats page (server render) and GET /api/chat-sessions (live refresh).
 */

export type ChatAttachmentItem = {
  url: string;
  name: string;
  mimeType: string;
  size: number | null;
};

export function readAttachments(value: unknown): ChatAttachmentItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const attachment = item as Record<string, unknown>;

    if (typeof attachment.url !== "string" || !attachment.url) {
      return [];
    }

    return [
      {
        url: attachment.url,
        name: typeof attachment.name === "string" ? attachment.name : "Attachment",
        mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType : "",
        size: typeof attachment.size === "number" ? attachment.size : null,
      },
    ];
  });
}

export type ChatListFilters = {
  status?: "ACTIVE" | "ESCALATED" | "CLOSED" | "OPEN" | null;
  channel?: string | null;
  contactId?: string | null;
  query?: string | null;
  /** Load exactly these sessions (ignores the other filters). */
  sessionIds?: string[] | null;
  take?: number;
};

const CHANNELS = new Set(["WEB_WIDGET", "WHATSAPP", "SLACK", "EMAIL", "VOICE"]);

export function parseChatListFilters(params: URLSearchParams): ChatListFilters {
  const status = params.get("status");
  const channel = params.get("channel");

  return {
    status:
      status === "ACTIVE" || status === "ESCALATED" || status === "CLOSED" || status === "OPEN"
        ? status
        : null,
    channel: channel && CHANNELS.has(channel) ? channel : null,
    contactId: params.get("contactId")?.slice(0, 40) || null,
    query: params.get("q")?.trim().slice(0, 120) || null,
  };
}

export async function loadChatSessionList(workspaceId: string, filters: ChatListFilters = {}) {
  const where: Prisma.ChatSessionWhereInput = { workspaceId };

  if (filters.sessionIds?.length) {
    where.id = { in: filters.sessionIds.slice(0, 20) };
  } else if (filters.status === "OPEN") {
    where.status = { in: ["ACTIVE", "ESCALATED"] };
  } else if (filters.status) {
    where.status = filters.status;
  }

  if (filters.channel && !filters.sessionIds?.length) {
    where.channel = filters.channel as Prisma.ChatSessionWhereInput["channel"];
  }

  if (filters.contactId && !filters.sessionIds?.length) {
    where.contactId = filters.contactId;
  }

  if (filters.query && !filters.sessionIds?.length) {
    const contains = { contains: filters.query, mode: "insensitive" as const };
    where.OR = [
      { customerName: contains },
      { customerEmail: contains },
      { customerPhone: contains },
      { contact: { is: { OR: [{ name: contains }, { email: contains }, { phone: contains }] } } },
      { messages: { some: { content: contains } } },
    ];
  }

  const sessions = await prisma.chatSession.findMany({
    where,
    select: {
      id: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      status: true,
      channel: true,
      startedAt: true,
      lastActivityAt: true,
      endedAt: true,
      updatedAt: true,
      closedReason: true,
      resolution: true,
      summary: true,
      messageCount: true,
      aiMessageCount: true,
      previousSessionId: true,
      chatbot: { select: { name: true, sessionTimeoutMinutes: true } },
      integration: { select: { name: true, type: true } },
      contact: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          _count: { select: { sessions: true, tickets: true } },
        },
      },
      messages: {
        select: {
          id: true,
          sender: true,
          content: true,
          attachments: true,
          authorName: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
    },
    orderBy: { lastActivityAt: "desc" },
    take: Math.min(100, filters.take ?? 50),
  });

  return sessions.map((item) => {
    const expiresAt = getSessionExpiresAt(item);

    return {
      id: item.id,
      customerName: item.customerName,
      customerEmail: item.customerEmail,
      customerPhone: item.customerPhone,
      status: item.status,
      channel: item.channel,
      startedAt: item.startedAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      lastActivityAt: item.lastActivityAt.toISOString(),
      endedAt: item.endedAt?.toISOString() ?? null,
      expiresAt: expiresAt?.toISOString() ?? null,
      idleTimeoutMinutes: getIdleTimeoutMinutes(item),
      closedReason: item.closedReason,
      resolution: item.resolution,
      summary: item.summary,
      messageCount: item.messageCount,
      aiMessageCount: item.aiMessageCount,
      previousSessionId: item.previousSessionId,
      chatbotName: item.chatbot?.name ?? null,
      integrationName: item.integration?.name ?? null,
      integrationType: item.integration?.type ?? null,
      contact: item.contact
        ? {
            id: item.contact.id,
            name: item.contact.name,
            email: item.contact.email,
            phone: item.contact.phone,
            sessionCount: item.contact._count.sessions,
            ticketCount: item.contact._count.tickets,
          }
        : null,
      messages: item.messages
        .slice()
        .reverse()
        .map((message) => ({
          id: message.id,
          sender: message.sender,
          content: message.content,
          authorName: message.authorName,
          attachments: readAttachments(message.attachments),
          createdAt: message.createdAt.toISOString(),
        })),
    };
  });
}

export type ChatSessionListItem = Awaited<ReturnType<typeof loadChatSessionList>>[number];
