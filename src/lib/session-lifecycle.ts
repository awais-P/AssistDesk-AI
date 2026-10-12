import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";
import { publishConversationEvent } from "./realtime";
import { scheduleMemoryRefresh } from "./session-memory";

/**
 * Conversation session lifecycle (Module 5 FE-1, FE-4, FE-5).
 *
 *   start ──► ACTIVE ◄──► ESCALATED (human takeover)
 *               │              │
 *               └──── CLOSED ◄─┘   reasons: IDLE_TIMEOUT, MAX_DURATION,
 *                                  CLOSED_BY_CUSTOMER, CLOSED_BY_AGENT
 *
 * A closed session is never reopened by the customer: the next message starts a
 * new session linked to the previous one (previousSessionId) and to the same
 * Contact, so the AI still has the full context (see session-memory.ts).
 */

export type SessionChannel = "WEB_WIDGET" | "WHATSAPP" | "SLACK" | "EMAIL" | "VOICE";
export type SessionCloseReason =
  | "IDLE_TIMEOUT"
  | "MAX_DURATION"
  | "CLOSED_BY_CUSTOMER"
  | "CLOSED_BY_AGENT";
export type SessionResolution = "AI_RESOLVED" | "HUMAN_HANDLED" | "UNANSWERED";

/** Idle timeout per channel. The website widget uses the chatbot's own setting. */
export const CHANNEL_IDLE_MINUTES: Record<SessionChannel, number> = {
  WEB_WIDGET: 30,
  // A Slack thread naturally pauses for hours.
  SLACK: 4 * 60,
  // WhatsApp's customer-service window is 24 hours after the customer's last message.
  WHATSAPP: 24 * 60,
  EMAIL: 7 * 24 * 60,
  VOICE: 10,
};

/** Hard cap for one website session, however active it is. */
export const MAX_WIDGET_SESSION_HOURS = 24;
/** While a human handles a chat, allow a longer pause before it expires. */
export const MIN_ESCALATED_IDLE_MINUTES = 60;
export const MIN_TIMEOUT_MINUTES = 5;
export const MAX_TIMEOUT_MINUTES = 24 * 60;

export function clampSessionTimeoutMinutes(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed)
    ? Math.min(MAX_TIMEOUT_MINUTES, Math.max(MIN_TIMEOUT_MINUTES, Math.round(parsed)))
    : CHANNEL_IDLE_MINUTES.WEB_WIDGET;
}

type PolicySession = {
  channel: string;
  status: string;
  startedAt: Date;
  lastActivityAt: Date;
  chatbot?: { sessionTimeoutMinutes: number } | null;
};

export function getIdleTimeoutMinutes(session: PolicySession) {
  const base =
    session.channel === "WEB_WIDGET"
      ? clampSessionTimeoutMinutes(session.chatbot?.sessionTimeoutMinutes ?? CHANNEL_IDLE_MINUTES.WEB_WIDGET)
      : CHANNEL_IDLE_MINUTES[session.channel as SessionChannel] ?? CHANNEL_IDLE_MINUTES.WEB_WIDGET;

  return session.status === "ESCALATED" ? Math.max(base, MIN_ESCALATED_IDLE_MINUTES) : base;
}

/** Why this session should be closed now, or null if it is still live. */
export function getExpiryReason(session: PolicySession, now = new Date()): SessionCloseReason | null {
  if (session.status === "CLOSED") {
    return null;
  }

  const idleMs = now.getTime() - session.lastActivityAt.getTime();

  if (idleMs >= getIdleTimeoutMinutes(session) * 60 * 1000) {
    return "IDLE_TIMEOUT";
  }

  if (
    session.channel === "WEB_WIDGET" &&
    now.getTime() - session.startedAt.getTime() >= MAX_WIDGET_SESSION_HOURS * 60 * 60 * 1000
  ) {
    return "MAX_DURATION";
  }

  return null;
}

/** When the session will expire if nothing else happens (shown in the dashboard). */
export function getSessionExpiresAt(session: PolicySession) {
  if (session.status === "CLOSED") {
    return null;
  }

  const idleDeadline = session.lastActivityAt.getTime() + getIdleTimeoutMinutes(session) * 60 * 1000;
  const hardDeadline =
    session.channel === "WEB_WIDGET"
      ? session.startedAt.getTime() + MAX_WIDGET_SESSION_HOURS * 60 * 60 * 1000
      : Number.POSITIVE_INFINITY;

  return new Date(Math.min(idleDeadline, hardDeadline));
}

export function computeResolution(stats: {
  aiMessages: number;
  agentMessages: number;
  wasEscalated: boolean;
}): SessionResolution {
  if (stats.agentMessages > 0 || stats.wasEscalated) {
    return "HUMAN_HANDLED";
  }

  return stats.aiMessages > 0 ? "AI_RESOLVED" : "UNANSWERED";
}

/** Widget session credentials: the token is secret, only its hash is stored. */
export function hashWidgetSessionToken(token: string) {
  return createHash("sha256").update(`widget-session:${token}`).digest("hex");
}

export function createSessionCredentials() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashWidgetSessionToken(token) };
}

export async function recordSessionEvent({
  workspaceId,
  sessionId = null,
  contactId = null,
  type,
  detail = null,
  metadata,
}: {
  workspaceId: string;
  sessionId?: string | null;
  contactId?: string | null;
  type: string;
  detail?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  try {
    await prisma.sessionEvent.create({
      data: { workspaceId, sessionId, contactId, type, detail, metadata },
    });
  } catch (error) {
    console.error("[sessions] Failed to record event:", error);
  }
}

type AppendMessageInput = {
  sessionId: string;
  workspaceId: string;
  sender: "USER" | "AI" | "AGENT" | "SYSTEM";
  content: string;
  attachments?: Prisma.InputJsonValue;
  authorName?: string | null;
  externalId?: string | null;
  /** SYSTEM notices don't count as activity (they must not keep a session alive). */
  countsAsActivity?: boolean;
};

/**
 * The one place messages are added to a session: stores the message, updates the
 * session counters and last activity (the idle clock), and publishes it live.
 */
export async function appendSessionMessage(input: AppendMessageInput) {
  const countsAsActivity = input.countsAsActivity ?? input.sender !== "SYSTEM";
  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        sessionId: input.sessionId,
        sender: input.sender,
        content: input.content,
        attachments: input.attachments,
        authorName: input.authorName ?? null,
        externalId: input.externalId ?? null,
      },
    }),
    prisma.chatSession.update({
      where: { id: input.sessionId },
      data: {
        messageCount: { increment: 1 },
        ...(input.sender === "AI" ? { aiMessageCount: { increment: 1 } } : {}),
        ...(countsAsActivity ? { lastActivityAt: new Date() } : {}),
      },
      select: { id: true },
    }),
  ]);

  publishConversationEvent({ workspaceId: input.workspaceId, sessionId: input.sessionId, type: "message" });

  return message;
}

type StartSessionInput = {
  workspaceId: string;
  channel: SessionChannel;
  chatbotId?: string | null;
  integrationId?: string | null;
  externalId?: string | null;
  contactId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  previousSessionId?: string | null;
  clientIpHash?: string | null;
  visitorId?: string | null;
  withToken?: boolean;
};

export async function startSession(input: StartSessionInput) {
  const credentials = input.withToken ? createSessionCredentials() : null;
  const session = await prisma.chatSession.create({
    data: {
      workspaceId: input.workspaceId,
      channel: input.channel,
      status: "ACTIVE",
      chatbotId: input.chatbotId ?? null,
      integrationId: input.integrationId ?? null,
      externalId: input.externalId ?? null,
      contactId: input.contactId ?? null,
      customerName: input.customerName ?? null,
      customerEmail: input.customerEmail ?? null,
      customerPhone: input.customerPhone ?? null,
      previousSessionId: input.previousSessionId ?? null,
      sessionTokenHash: credentials?.tokenHash ?? null,
      clientIpHash: input.clientIpHash ?? null,
      visitorId: input.visitorId ?? null,
    },
  });

  await recordSessionEvent({
    workspaceId: input.workspaceId,
    sessionId: session.id,
    contactId: session.contactId,
    type: input.previousSessionId ? "SESSION_RESUMED" : "SESSION_STARTED",
    detail: input.previousSessionId
      ? "New session started for a returning customer; previous conversation context carried over."
      : `Session started on ${input.channel.replace("_", " ").toLowerCase()}.`,
    metadata: { channel: input.channel, previousSessionId: input.previousSessionId ?? null },
  });

  publishConversationEvent({ workspaceId: input.workspaceId, sessionId: session.id, type: "session" });

  return { session, token: credentials?.token ?? null };
}

const closeNotices: Partial<Record<SessionCloseReason, (minutes: number) => string>> = {
  IDLE_TIMEOUT: (minutes) =>
    `This conversation was closed after ${minutes >= 60 ? `${Math.round(minutes / 60)} hour(s)` : `${minutes} minutes`} of inactivity. Send a message any time to start a new one — we'll remember what we talked about.`,
  MAX_DURATION: () =>
    "This conversation reached its maximum length and was closed. Send a message to continue in a new conversation.",
  CLOSED_BY_CUSTOMER: () => "You ended this conversation. Send a message any time to start a new one.",
  CLOSED_BY_AGENT: () => "This conversation was closed by our team. Send a message if you need anything else.",
};

/**
 * Closes a session with a reason, records its outcome (resolution) for history and
 * analytics, leaves a notice for the customer, and schedules the memory update.
 */
export async function closeSession(
  sessionId: string,
  reason: SessionCloseReason,
  { actorName = null }: { actorName?: string | null } = {},
) {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: { chatbot: { select: { sessionTimeoutMinutes: true } } },
  });

  if (!session || session.status === "CLOSED") {
    return session;
  }

  const [agentMessages, escalations] = await Promise.all([
    prisma.chatMessage.count({ where: { sessionId, sender: "AGENT" } }),
    prisma.sessionEvent.count({ where: { sessionId, type: "HUMAN_TAKEOVER" } }),
  ]);
  const resolution = computeResolution({
    aiMessages: session.aiMessageCount,
    agentMessages,
    wasEscalated: escalations > 0 || session.status === "ESCALATED",
  });
  const endedAt = new Date();

  const updated = await prisma.chatSession.update({
    where: { id: sessionId },
    data: { status: "CLOSED", endedAt, closedReason: reason, resolution },
  });

  const notice = closeNotices[reason]?.(getIdleTimeoutMinutes(session));

  if (notice) {
    await appendSessionMessage({
      sessionId,
      workspaceId: session.workspaceId,
      sender: "SYSTEM",
      content: notice,
      countsAsActivity: false,
    });
  }

  await recordSessionEvent({
    workspaceId: session.workspaceId,
    sessionId,
    contactId: session.contactId,
    type: reason === "IDLE_TIMEOUT" || reason === "MAX_DURATION" ? "SESSION_EXPIRED" : "SESSION_CLOSED",
    detail: `${reason.replaceAll("_", " ").toLowerCase()}${actorName ? ` by ${actorName}` : ""} · ${resolution.replace("_", " ").toLowerCase()} · ${Math.max(1, Math.round((endedAt.getTime() - session.startedAt.getTime()) / 60000))} min`,
    metadata: { reason, resolution, durationSeconds: Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000) },
  });

  publishConversationEvent({ workspaceId: session.workspaceId, sessionId, type: "status" });
  scheduleMemoryRefresh({ sessionId, contactId: session.contactId, finalSummary: true });

  return updated;
}

/**
 * Closes sessions whose idle or maximum-duration policy has passed (FE-5). Runs
 * lazily when a session is used, when the Chats page loads, and from the cron route.
 */
export async function expireIdleSessions({
  workspaceId,
  limit = 100,
}: { workspaceId?: string; limit?: number } = {}) {
  const candidates = await prisma.chatSession.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      status: { in: ["ACTIVE", "ESCALATED"] },
      OR: [
        { lastActivityAt: { lt: new Date(Date.now() - MIN_TIMEOUT_MINUTES * 60 * 1000) } },
        { startedAt: { lt: new Date(Date.now() - MAX_WIDGET_SESSION_HOURS * 60 * 60 * 1000) } },
      ],
    },
    include: { chatbot: { select: { sessionTimeoutMinutes: true } } },
    orderBy: { lastActivityAt: "asc" },
    take: limit,
  });

  let closed = 0;

  for (const session of candidates) {
    const reason = getExpiryReason(session);

    if (reason) {
      await closeSession(session.id, reason);
      closed += 1;
    }
  }

  return closed;
}

/**
 * Returns the session to use for a new message on a persistent channel (Slack,
 * WhatsApp): the open session for this conversation, or a new one linked to the
 * previous if it expired or was closed.
 */
export async function getOrStartChannelSession(input: {
  workspaceId: string;
  channel: "SLACK" | "WHATSAPP";
  integrationId: string;
  externalId: string;
  contactId: string | null;
  customerName: string | null;
  customerPhone?: string | null;
}) {
  const latest = await prisma.chatSession.findFirst({
    where: { integrationId: input.integrationId, externalId: input.externalId },
    orderBy: { startedAt: "desc" },
  });

  if (latest && latest.status !== "CLOSED") {
    const reason = getExpiryReason(latest);

    if (!reason) {
      return { session: latest, started: false, previousSessionId: null as string | null };
    }

    await closeSession(latest.id, reason);
  }

  const { session } = await startSession({
    workspaceId: input.workspaceId,
    channel: input.channel,
    integrationId: input.integrationId,
    externalId: input.externalId,
    contactId: input.contactId,
    customerName: input.customerName,
    customerPhone: input.customerPhone ?? null,
    previousSessionId: latest?.id ?? null,
  });

  return { session, started: true, previousSessionId: latest?.id ?? null };
}
