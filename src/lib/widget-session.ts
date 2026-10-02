import type { Prisma } from "@/app/generated/prisma/client";
import type { WidgetChatbot } from "./chatbot-widget";
import { type ContactIdentity, normalizeVisitorId, resolveContact } from "./contacts";
import { prisma } from "./prisma";
import { RATE_LIMITS, type RateLimitResult, consumeRateLimit } from "./rate-limit";
import {
  closeSession,
  getExpiryReason,
  getIdleTimeoutMinutes,
  getSessionExpiresAt,
  hashWidgetSessionToken,
  recordSessionEvent,
  startSession,
} from "./session-lifecycle";
import { WIDGET_SESSION_HEADER } from "./widget-constants";

/**
 * Website widget sessions (Module 5 FE-1): the widget holds a secret session token
 * (only its hash is stored). The session id alone gives no access, fixing SEC-18.
 */

const sessionInclude = { chatbot: { select: { sessionTimeoutMinutes: true } } } as const;

export type WidgetSession = Prisma.ChatSessionGetPayload<{ include: typeof sessionInclude }>;

export function readWidgetSessionToken(request: Request) {
  const token =
    request.headers.get(WIDGET_SESSION_HEADER) || new URL(request.url).searchParams.get("session");
  return token && token.length >= 20 && token.length <= 200 ? token : null;
}

/**
 * The session this token belongs to, after applying the expiry policy: an idle or
 * over-long session is closed right here, so every caller sees the true status.
 */
export async function loadWidgetSession(chatbot: WidgetChatbot, token: string | null) {
  if (!token) {
    return null;
  }

  const session = await prisma.chatSession.findFirst({
    where: {
      sessionTokenHash: hashWidgetSessionToken(token),
      chatbotId: chatbot.id,
      workspaceId: chatbot.workspaceId,
    },
    include: sessionInclude,
  });

  if (!session) {
    return null;
  }

  const reason = getExpiryReason(session);

  if (reason) {
    await closeSession(session.id, reason);
    return prisma.chatSession.findUnique({ where: { id: session.id }, include: sessionInclude });
  }

  return session;
}

export function serializeWidgetSession(session: WidgetSession) {
  const expiresAt = getSessionExpiresAt(session);

  return {
    id: session.id,
    status: session.status,
    customerName: session.customerName,
    customerEmail: session.customerEmail,
    customerPhone: session.customerPhone,
    startedAt: session.startedAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
    idleTimeoutMinutes: getIdleTimeoutMinutes(session),
    closedReason: session.closedReason,
    continuesPrevious: Boolean(session.previousSessionId),
    leadState: session.leadState,
  };
}

type SessionForMessage =
  | {
      ok: true;
      session: WidgetSession;
      /** Only set when a new session was created: the widget must store it. */
      newToken: string | null;
      started: boolean;
      previous: { id: string; closedReason: string | null } | null;
    }
  | { ok: false; rateLimit: RateLimitResult };

/**
 * Returns the session a new customer message belongs to. Continues the open session,
 * or starts a new one (linked to the previous session and the same Contact) when there
 * is none or the old one expired/closed. Also links the customer's identity.
 */
export async function getSessionForMessage({
  chatbot,
  token,
  identity,
  clientIpHash,
}: {
  chatbot: WidgetChatbot;
  token: string | null;
  identity: ContactIdentity;
  clientIpHash: string;
}): Promise<SessionForMessage> {
  const existing = await loadWidgetSession(chatbot, token);
  const contact = await resolveContact(chatbot.workspaceId, identity, "WEB_WIDGET");
  const visitorId = normalizeVisitorId(identity.visitorId);

  if (existing && existing.status !== "CLOSED") {
    const updates: Prisma.ChatSessionUpdateInput = {};

    if (contact && existing.contactId !== contact.id) updates.contact = { connect: { id: contact.id } };
    // Only fill in or change details the visitor actually sent; never wipe them.
    if (identity.name && identity.name !== existing.customerName) updates.customerName = identity.name;
    if (identity.email && identity.email !== existing.customerEmail) updates.customerEmail = identity.email;
    if (identity.phone && identity.phone !== existing.customerPhone) updates.customerPhone = identity.phone;
    if (visitorId && !existing.visitorId) updates.visitorId = visitorId;

    if (Object.keys(updates).length === 0) {
      return { ok: true, session: existing, newToken: null, started: false, previous: null };
    }

    const session = await prisma.chatSession.update({
      where: { id: existing.id },
      data: updates,
      include: sessionInclude,
    });

    if (contact && existing.contactId !== contact.id) {
      await recordSessionEvent({
        workspaceId: chatbot.workspaceId,
        sessionId: session.id,
        contactId: contact.id,
        type: "IDENTITY_LINKED",
        detail: "Visitor identified; conversation linked to their customer record.",
      });
    }

    return { ok: true, session, newToken: null, started: false, previous: null };
  }

  const newSessionLimit = await consumeRateLimit(
    `widget-new-session:${chatbot.id}:${clientIpHash}`,
    RATE_LIMITS.widgetNewSessionPerIp,
  );

  if (!newSessionLimit.allowed) {
    return { ok: false, rateLimit: newSessionLimit };
  }

  const { session, token: newToken } = await startSession({
    workspaceId: chatbot.workspaceId,
    channel: "WEB_WIDGET",
    chatbotId: chatbot.id,
    contactId: contact?.id ?? existing?.contactId ?? null,
    customerName: identity.name ?? existing?.customerName ?? null,
    customerEmail: identity.email ?? existing?.customerEmail ?? null,
    customerPhone: identity.phone ?? existing?.customerPhone ?? null,
    previousSessionId: existing?.id ?? null,
    clientIpHash,
    visitorId,
    withToken: true,
  });
  const withPolicy = await prisma.chatSession.findUniqueOrThrow({
    where: { id: session.id },
    include: sessionInclude,
  });

  return {
    ok: true,
    session: withPolicy,
    newToken,
    started: true,
    previous: existing ? { id: existing.id, closedReason: existing.closedReason } : null,
  };
}
