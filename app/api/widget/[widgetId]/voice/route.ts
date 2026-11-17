import { NextResponse } from "next/server";
import { authorizeWidgetRequest } from "@/src/lib/chatbot-widget";
import { normalizeEmail, normalizePhone, resolveContact } from "@/src/lib/contacts";
import { prisma } from "@/src/lib/prisma";
import { RATE_LIMITS, consumeRateLimit, getRequestIp, hashClientIp, tooManyRequests } from "@/src/lib/rate-limit";
import { closeSession, recordSessionEvent, startSession } from "@/src/lib/session-lifecycle";
import { isVoiceConfigured, mintVoiceToken, voiceConnectionUrls } from "@/src/lib/voice";
import { loadWidgetSession, readWidgetSessionToken, serializeWidgetSession } from "@/src/lib/widget-session";

export const dynamic = "force-dynamic";

type VoiceRouteContext = { params: Promise<{ widgetId: string }> };

type VoicePayload = {
  action?: unknown;
  /** The visitor's website-chat session token, so the call joins the same customer. */
  chatSessionToken?: unknown;
  customerName?: unknown;
  customerEmail?: unknown;
  customerPhone?: unknown;
  visitorId?: unknown;
  messageId?: unknown;
  firstAudioMs?: unknown;
};

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

const tokenFailed = () =>
  NextResponse.json({ error: "The call could not be connected. Please try again in a moment." }, { status: 502 });

/**
 * Voice calls from the website widget (Module 6 FE-6..8, FR-16.6):
 *   start   → a new VOICE conversation for this visitor (same customer as their chat) and
 *             a short-lived Deepgram token + addresses for speech-to-text and speech
 *   token   → a fresh token for the open call (to reconnect speech)
 *   metrics → the time from the end of the caller's speech to the first audio of a reply
 *   end     → the caller hung up
 * The caller's words then go through POST …/messages with the call's session token.
 */
export async function POST(request: Request, context: VoiceRouteContext) {
  const { widgetId } = await context.params;
  const access = await authorizeWidgetRequest(request, widgetId);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { chatbot } = access;

  if (!chatbot.isActive || !chatbot.voiceEnabled || !isVoiceConfigured()) {
    return NextResponse.json({ error: "Voice calls are not available for this chat." }, { status: 403 });
  }

  const body = ((await request.json().catch(() => null)) ?? {}) as VoicePayload;
  const action = text(body.action, 20);
  const clientIpHash = hashClientIp(getRequestIp(request));

  if (action === "start") {
    const limit = await consumeRateLimit(`widget-voice:${chatbot.id}:${clientIpHash}`, RATE_LIMITS.widgetVoiceCallPerIp);

    if (!limit.allowed) {
      return tooManyRequests(limit, "Too many calls were started from your connection. Please try again later.");
    }

    // The call belongs to the same customer as the visitor's chat (Module 5 FE-2).
    const chat = await loadWidgetSession(chatbot, text(body.chatSessionToken, 200) || null);
    const rawEmail = text(body.customerEmail, 160);
    const rawPhone = text(body.customerPhone, 32);
    const identity = {
      name: text(body.customerName, 120) || chat?.customerName || null,
      email: (rawEmail && normalizeEmail(rawEmail)) || chat?.customerEmail || null,
      phone: (rawPhone && normalizePhone(rawPhone)) || chat?.customerPhone || null,
      visitorId: text(body.visitorId, 64) || chat?.visitorId || null,
    };

    if (chatbot.requireEmail && !identity.email) {
      return NextResponse.json({ error: "Please provide your email before starting a call." }, { status: 400 });
    }

    const contact = await resolveContact(chatbot.workspaceId, identity, "VOICE");
    let grant: Awaited<ReturnType<typeof mintVoiceToken>>;

    try {
      grant = await mintVoiceToken();
    } catch (error) {
      console.error("[voice] Could not create a call token:", error);
      return tokenFailed();
    }

    const { session, token } = await startSession({
      workspaceId: chatbot.workspaceId,
      channel: "VOICE",
      chatbotId: chatbot.id,
      contactId: contact?.id ?? chat?.contactId ?? null,
      customerName: identity.name,
      customerEmail: identity.email,
      customerPhone: identity.phone,
      previousSessionId: chat?.id ?? null,
      clientIpHash,
      visitorId: identity.visitorId,
      withToken: true,
    });
    await recordSessionEvent({
      workspaceId: chatbot.workspaceId,
      sessionId: session.id,
      contactId: session.contactId,
      type: "VOICE_CALL_STARTED",
      detail: `Voice call started from ${access.isPreview ? "the dashboard preview" : access.host}.`,
    });
    const loaded = await loadWidgetSession(chatbot, token);

    return NextResponse.json(
      {
        sessionToken: token,
        session: loaded ? serializeWidgetSession(loaded) : null,
        deepgram: { ...grant, ...voiceConnectionUrls() },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Every other action works on the open call (its session token in the header).
  const call = await loadWidgetSession(chatbot, readWidgetSessionToken(request));

  if (!call || call.channel !== "VOICE") {
    return NextResponse.json({ error: "This call has ended." }, { status: 404 });
  }

  if (action === "token") {
    if (call.status === "CLOSED") {
      return NextResponse.json({ error: "This call has ended." }, { status: 404 });
    }

    const limit = await consumeRateLimit(`widget-voice-token:${call.id}`, RATE_LIMITS.widgetVoiceTokenPerSession);

    if (!limit.allowed) {
      return tooManyRequests(limit, "The call reconnected too often. Please start a new call.");
    }

    try {
      return NextResponse.json({ deepgram: { ...(await mintVoiceToken()), ...voiceConnectionUrls() } }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("[voice] Could not renew a call token:", error);
      return tokenFailed();
    }
  }

  if (action === "metrics") {
    const messageId = text(body.messageId, 40);
    const firstAudioMs = Number(body.firstAudioMs);

    if (!messageId || !Number.isFinite(firstAudioMs) || firstAudioMs < 0 || firstAudioMs > 120_000) {
      return NextResponse.json({ error: "Invalid measurement." }, { status: 400 });
    }

    // Only for a reply in this call, and only once.
    const updated = await prisma.aiInteraction.updateMany({
      where: { messageId, sessionId: call.id, channel: "VOICE", firstAudioMs: null },
      data: { firstAudioMs: Math.round(firstAudioMs) },
    });

    return NextResponse.json({ recorded: updated.count > 0 });
  }

  if (action === "end") {
    await closeSession(call.id, "CLOSED_BY_CUSTOMER");
    return NextResponse.json({ ended: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
