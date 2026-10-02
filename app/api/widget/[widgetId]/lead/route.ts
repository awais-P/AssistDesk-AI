import { NextResponse } from "next/server";
import { authorizeWidgetRequest } from "@/src/lib/chatbot-widget";
import { formatSuccessMessage, parseLeadForm, validateLeadSubmission } from "@/src/lib/lead-form";
import { captureLead } from "@/src/lib/leads";
import { prisma } from "@/src/lib/prisma";
import {
  RATE_LIMITS,
  consumeRateLimit,
  getRequestIp,
  hashClientIp,
  tooManyRequests,
} from "@/src/lib/rate-limit";
import { appendSessionMessage, recordSessionEvent } from "@/src/lib/session-lifecycle";
import { respondToVisitor, serializeWidgetMessage } from "@/src/lib/widget-conversation";
import { loadWidgetSession, readWidgetSessionToken, serializeWidgetSession } from "@/src/lib/widget-session";

type WidgetLeadRouteContext = {
  params: Promise<{
    widgetId: string;
  }>;
};

type LeadPayload = {
  values?: unknown;
  consent?: unknown;
  skip?: unknown;
};

/**
 * The visitor submits or skips the inline lead form (Module 8 FE-1). The fields are
 * validated against the chatbot's form, the lead is created or updated, and then the
 * AI answers the question it held back while the form was shown.
 */
export async function POST(request: Request, context: WidgetLeadRouteContext) {
  const { widgetId } = await context.params;
  const access = await authorizeWidgetRequest(request, widgetId);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { chatbot } = access;
  const limit = await consumeRateLimit(
    `widget-lead:${hashClientIp(getRequestIp(request))}`,
    RATE_LIMITS.widgetLeadPerIp,
  );

  if (!limit.allowed) {
    return tooManyRequests(limit, "Too many form submissions.");
  }

  const session = await loadWidgetSession(chatbot, readWidgetSessionToken(request));

  if (!session || session.status === "CLOSED") {
    return NextResponse.json({ error: "This conversation has ended. Send a message to start a new one." }, { status: 409 });
  }

  const form = parseLeadForm(chatbot.leadForm);

  if (!form.enabled) {
    return NextResponse.json({ error: "Lead capture is not enabled for this chat." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as LeadPayload | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // The question the visitor asked before the form appeared, if nobody answered it yet.
  const lastMessages = await prisma.chatMessage.findMany({
    where: { sessionId: session.id, sender: { not: "SYSTEM" } },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { sender: true, content: true },
  });
  const pendingQuestion = lastMessages[0]?.sender === "USER" ? lastMessages[0].content : null;
  const wasPrompted = session.leadState === "PROMPTED";

  if (body.skip === true) {
    if (!form.allowSkip) {
      return NextResponse.json({ error: "Please fill in the form to continue." }, { status: 400 });
    }

    await prisma.chatSession.update({ where: { id: session.id }, data: { leadState: "SKIPPED" }, select: { id: true } });
    await recordSessionEvent({
      workspaceId: chatbot.workspaceId,
      sessionId: session.id,
      contactId: session.contactId,
      type: "LEAD_FORM_SKIPPED",
      detail: "The visitor skipped the lead form.",
    });

    const reply = wasPrompted && pendingQuestion ? await respondToVisitor(chatbot, session.id, pendingQuestion) : null;
    const fresh = await loadWidgetSession(chatbot, readWidgetSessionToken(request));

    return NextResponse.json({
      session: fresh ? serializeWidgetSession(fresh) : null,
      messages: (reply?.messages ?? []).map(serializeWidgetMessage),
      waitingForHuman: reply?.waitingForHuman ?? false,
      lead: null,
    });
  }

  const rawValues =
    body.values && typeof body.values === "object" && !Array.isArray(body.values)
      ? (body.values as Record<string, unknown>)
      : {};
  const validation = validateLeadSubmission(form, rawValues);

  if (!validation.ok) {
    return NextResponse.json(
      { error: "Please check the highlighted fields.", fieldErrors: validation.errors },
      { status: 400 },
    );
  }

  const { lead, created } = await captureLead({
    workspaceId: chatbot.workspaceId,
    channel: "WEB_WIDGET",
    source: "FORM",
    values: validation.values,
    chatbotId: chatbot.id,
    sessionId: session.id,
    contactId: session.contactId,
    visitorId: session.visitorId,
    marketingConsent: Boolean(form.consentText) && body.consent === true,
    pageHost: access.isPreview ? null : access.host,
  });

  const thanks = await appendSessionMessage({
    sessionId: session.id,
    workspaceId: chatbot.workspaceId,
    sender: "SYSTEM",
    content: formatSuccessMessage(form, validation.values.name),
  });
  const reply = wasPrompted && pendingQuestion ? await respondToVisitor(chatbot, session.id, pendingQuestion) : null;
  const fresh = await loadWidgetSession(chatbot, readWidgetSessionToken(request));

  return NextResponse.json({
    session: fresh ? serializeWidgetSession(fresh) : null,
    messages: [thanks, ...(reply?.messages ?? [])].map(serializeWidgetMessage),
    waitingForHuman: reply?.waitingForHuman ?? false,
    lead: { id: lead.id, created },
    // What the widget should remember locally for the visitor's contact card.
    contact: { name: validation.values.name, email: validation.values.email, phone: validation.values.phone },
  });
}
