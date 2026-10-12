import { NextResponse } from "next/server";
import { authorizeWidgetRequest } from "@/src/lib/chatbot-widget";
import { normalizeEmail, normalizePhone, resolveContact } from "@/src/lib/contacts";
import { extractContactDetails, parseLeadForm, publicLeadForm } from "@/src/lib/lead-form";
import { evaluateLeadCapture } from "@/src/lib/leads";
import { createNotification } from "@/src/lib/notifications";
import { isWorkspaceOnline } from "@/src/lib/presence";
import { prisma } from "@/src/lib/prisma";
import {
  RATE_LIMITS,
  consumeRateLimit,
  getRequestIp,
  hashClientIp,
  tooManyRequests,
} from "@/src/lib/rate-limit";
import { appendSessionMessage, recordSessionEvent } from "@/src/lib/session-lifecycle";
import {
  MAX_WIDGET_MESSAGE_LENGTH,
  parseWidgetAttachments,
  respondToVisitor,
  runFallbackIfDue,
  serializeWidgetMessage,
} from "@/src/lib/widget-conversation";
import {
  getSessionForMessage,
  loadWidgetSession,
  readWidgetSessionToken,
  serializeWidgetSession,
} from "@/src/lib/widget-session";

type WidgetMessagesRouteContext = {
  params: Promise<{
    widgetId: string;
  }>;
};

type WidgetMessagePayload = {
  message?: unknown;
  customerName?: unknown;
  customerEmail?: unknown;
  customerPhone?: unknown;
  visitorId?: unknown;
  attachments?: unknown;
};

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/** Current conversation for this visitor (by secret session token). */
export async function GET(request: Request, context: WidgetMessagesRouteContext) {
  const { widgetId } = await context.params;
  const access = await authorizeWidgetRequest(request, widgetId);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { chatbot } = access;
  const operatorsOnline = await isWorkspaceOnline(chatbot.workspaceId);
  const session = await loadWidgetSession(chatbot, readWidgetSessionToken(request));

  if (!session) {
    return NextResponse.json({ session: null, messages: [], operatorsOnline });
  }

  if (session.status !== "CLOSED") {
    await runFallbackIfDue(chatbot, session.id);
  }

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { feedback: { select: { rating: true } } },
  });

  const leadForm = session.leadState === "PROMPTED" ? parseLeadForm(chatbot.leadForm) : null;

  return NextResponse.json({
    session: serializeWidgetSession(session),
    messages: messages.reverse().map(serializeWidgetMessage),
    operatorsOnline,
    leadPrompt:
      leadForm?.enabled && session.status !== "CLOSED"
        ? {
            form: publicLeadForm(leadForm),
            prefill: {
              name: session.customerName ?? "",
              email: session.customerEmail ?? "",
              phone: session.customerPhone ?? "",
            },
          }
        : null,
  });
}

/** A visitor sends a message: session lifecycle, rate limits, identity, reply. */
export async function POST(request: Request, context: WidgetMessagesRouteContext) {
  const { widgetId } = await context.params;
  const access = await authorizeWidgetRequest(request, widgetId);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { chatbot } = access;

  if (!chatbot.isActive) {
    return NextResponse.json(
      { error: `${chatbot.name} is paused right now. Please try again later.` },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as WidgetMessagePayload | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const clientIpHash = hashClientIp(getRequestIp(request));

  // FE-6: abuse protection before any work is done (per IP, then per widget).
  for (const [key, policy, message] of [
    [`widget-ip:${clientIpHash}`, RATE_LIMITS.widgetMessagePerIp, "You're sending messages too quickly."],
    [`widget:${chatbot.id}`, RATE_LIMITS.widgetMessagePerWidget, "This chat is very busy right now."],
  ] as const) {
    const result = await consumeRateLimit(key, policy);

    if (!result.allowed) {
      await recordSessionEvent({
        workspaceId: chatbot.workspaceId,
        type: "RATE_LIMITED",
        detail: `${key.startsWith("widget-ip") ? "Per-visitor" : "Per-widget"} message limit exceeded on ${chatbot.name}.`,
        metadata: { scope: key.split(":")[0], clientIpHash, limit: policy.limit },
      });
      return tooManyRequests(result, message);
    }
  }

  const rawEmail = text(body.customerEmail, 160);
  const rawPhone = text(body.customerPhone, 32);
  const customerEmail = rawEmail ? normalizeEmail(rawEmail) : null;
  const customerPhone = rawPhone ? normalizePhone(rawPhone) : null;
  const customerName = text(body.customerName, 120) || null;
  const content = text(body.message, MAX_WIDGET_MESSAGE_LENGTH + 1);
  const attachments = parseWidgetAttachments(body.attachments);

  if (rawEmail && !customerEmail) {
    return NextResponse.json(
      { error: "Please enter a valid email address, like name@example.com." },
      { status: 400 },
    );
  }

  if (rawPhone && !customerPhone) {
    return NextResponse.json(
      { error: "Please enter a valid phone number, for example +92 300 1234567." },
      { status: 400 },
    );
  }

  if (!attachments) {
    return NextResponse.json(
      { error: "One of the attachments is invalid. Please upload it again." },
      { status: 400 },
    );
  }

  if (!content && attachments.length === 0) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }

  if (content.length > MAX_WIDGET_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Messages can be up to ${MAX_WIDGET_MESSAGE_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const resolved = await getSessionForMessage({
    chatbot,
    token: readWidgetSessionToken(request),
    identity: {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      visitorId: text(body.visitorId, 64) || null,
    },
    clientIpHash,
  });

  if (!resolved.ok) {
    await recordSessionEvent({
      workspaceId: chatbot.workspaceId,
      type: "RATE_LIMITED",
      detail: `Too many new conversations from one visitor on ${chatbot.name}.`,
      metadata: { scope: "widget-new-session", clientIpHash },
    });
    return tooManyRequests(resolved.rateLimit, "Too many new conversations were started from your connection.");
  }

  const { session } = resolved;

  if (chatbot.requireName && !session.customerName) {
    return NextResponse.json({ error: "Please provide your name before starting the chat." }, { status: 400 });
  }

  if (chatbot.requireEmail && !session.customerEmail) {
    return NextResponse.json({ error: "Please provide your email before starting the chat." }, { status: 400 });
  }

  if (chatbot.requirePhone && !session.customerPhone) {
    return NextResponse.json({ error: "Please provide your phone number before starting the chat." }, { status: 400 });
  }

  // FE-6: the chatbot's own per-conversation limit (Chatbot → AI Responses).
  const perSession = await consumeRateLimit(`widget-session:${session.id}`, {
    limit: chatbot.rateLimitPerMinute,
    windowSeconds: 60,
  });

  if (!perSession.allowed) {
    await recordSessionEvent({
      workspaceId: chatbot.workspaceId,
      sessionId: session.id,
      contactId: session.contactId,
      type: "RATE_LIMITED",
      detail: `More than ${chatbot.rateLimitPerMinute} messages in a minute.`,
      metadata: { scope: "widget-session", limit: chatbot.rateLimitPerMinute, clientIpHash },
    });
    await createNotification({
      workspaceId: chatbot.workspaceId,
      type: "RATE_LIMITED",
      severity: "WARNING",
      title: `A visitor hit the message limit on ${chatbot.name}`,
      body: `More than ${chatbot.rateLimitPerMinute} messages per minute were blocked.`,
      link: "/dashboard/chats",
      dedupeMinutes: 30,
    });
    return tooManyRequests(perSession, "You're sending messages too quickly.");
  }

  const userMessage = await appendSessionMessage({
    sessionId: session.id,
    workspaceId: chatbot.workspaceId,
    sender: "USER",
    content,
    attachments: attachments.length > 0 ? attachments : undefined,
    authorName: session.customerName,
  });

  if (resolved.started) {
    await createNotification({
      workspaceId: chatbot.workspaceId,
      type: "NEW_CHAT",
      title: `${resolved.previous ? "Returning visitor" : "New chat"}: ${session.customerName || session.customerEmail || "a website visitor"}`,
      body: `${chatbot.name}: ${content.slice(0, 140)}`,
      link: "/dashboard/chats",
    });
  }

  // Module 8 FE-2: contact details the visitor types in the chat are remembered and
  // linked to their customer record, like details given in a form.
  let current = session;
  const typed = extractContactDetails(content);

  if ((typed.email && !session.customerEmail) || (typed.phone && !session.customerPhone)) {
    const contact = await resolveContact(
      chatbot.workspaceId,
      {
        name: session.customerName,
        email: typed.email,
        phone: typed.phone,
        visitorId: text(body.visitorId, 64) || null,
      },
      "WEB_WIDGET",
    );
    current = await prisma.chatSession.update({
      where: { id: session.id },
      data: {
        customerEmail: session.customerEmail ?? typed.email,
        customerPhone: session.customerPhone ?? typed.phone,
        ...(contact ? { contactId: contact.id } : {}),
      },
      include: { chatbot: { select: { sessionTimeoutMinutes: true } } },
    });
  }

  // A visitor who keeps chatting instead of filling in the lead form has skipped it.
  if (current.leadState === "PROMPTED") {
    current = await prisma.chatSession.update({
      where: { id: session.id },
      data: { leadState: "SKIPPED" },
      include: { chatbot: { select: { sessionTimeoutMinutes: true } } },
    });
    await recordSessionEvent({
      workspaceId: chatbot.workspaceId,
      sessionId: session.id,
      contactId: current.contactId,
      type: "LEAD_FORM_SKIPPED",
      detail: "The visitor kept chatting without filling in the lead form.",
    });
  }

  // Module 8 FE-1: show the lead form (and hold the AI) or capture the lead directly.
  const leadDecision = await evaluateLeadCapture({
    session: current,
    message: content,
    chatbotLeadForm: chatbot.leadForm,
    pageHost: access.isPreview ? null : access.host,
  });
  const newMessages = [userMessage];
  let waitingForHuman = false;

  if (leadDecision.action !== "PROMPT") {
    const reply = await respondToVisitor(chatbot, session.id, content);
    newMessages.push(...reply.messages);
    waitingForHuman = reply.waitingForHuman;
  }

  const fresh = await prisma.chatSession.findUniqueOrThrow({
    where: { id: session.id },
    include: { chatbot: { select: { sessionTimeoutMinutes: true } } },
  });

  return NextResponse.json({
    session: serializeWidgetSession(fresh),
    // Returned only when a new conversation started; the widget stores it.
    sessionToken: resolved.newToken,
    sessionStarted: resolved.started,
    previousSession: resolved.previous,
    messages: newMessages.map(serializeWidgetMessage),
    waitingForHuman,
    // The AI waits until the visitor submits or skips this form.
    leadPrompt:
      leadDecision.action === "PROMPT"
        ? { form: publicLeadForm(leadDecision.form), prefill: leadDecision.prefill }
        : null,
    leadCaptured: leadDecision.action === "CAPTURED",
  });
}
