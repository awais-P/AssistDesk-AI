import { NextResponse } from "next/server";
import { authorizeWidgetRequest } from "@/src/lib/chatbot-widget";
import { prisma } from "@/src/lib/prisma";
import {
  RATE_LIMITS,
  consumeRateLimit,
  getRequestIp,
  hashClientIp,
  tooManyRequests,
} from "@/src/lib/rate-limit";
import { loadWidgetSession, readWidgetSessionToken } from "@/src/lib/widget-session";

type WidgetFeedbackRouteContext = {
  params: Promise<{
    widgetId: string;
  }>;
};

/**
 * 👍 / 👎 on an AI reply (Module 6 FE-3 feedback loop, feeds Module 4 FE-5). Only the
 * visitor of the conversation can rate its AI messages; rating again changes the vote,
 * `rating: 0` removes it.
 */
export async function POST(request: Request, context: WidgetFeedbackRouteContext) {
  const { widgetId } = await context.params;
  const access = await authorizeWidgetRequest(request, widgetId);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const limit = await consumeRateLimit(
    `widget-feedback:${hashClientIp(getRequestIp(request))}`,
    RATE_LIMITS.widgetMessagePerIp,
  );

  if (!limit.allowed) {
    return tooManyRequests(limit, "Too many ratings.");
  }

  const session = await loadWidgetSession(access.chatbot, readWidgetSessionToken(request));

  if (!session) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { messageId?: unknown; rating?: unknown; comment?: unknown };
  const messageId = typeof body.messageId === "string" ? body.messageId.slice(0, 40) : "";
  const rating = body.rating === 1 || body.rating === -1 || body.rating === 0 ? body.rating : null;
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 500) || null : null;

  if (!messageId || rating === null) {
    return NextResponse.json({ error: "messageId and a rating of 1, -1 or 0 are required." }, { status: 400 });
  }

  const message = await prisma.chatMessage.findFirst({
    where: { id: messageId, sessionId: session.id, sender: "AI" },
    select: { id: true },
  });

  if (!message) {
    return NextResponse.json({ error: "Only the assistant's replies in your conversation can be rated." }, { status: 404 });
  }

  if (rating === 0) {
    await prisma.messageFeedback.deleteMany({ where: { messageId } });
    return NextResponse.json({ rating: 0 });
  }

  const feedback = await prisma.messageFeedback.upsert({
    where: { messageId },
    update: { rating, comment },
    create: { workspaceId: access.chatbot.workspaceId, messageId, sessionId: session.id, rating, comment },
    select: { rating: true, comment: true },
  });

  return NextResponse.json(feedback);
}
