import { NextResponse } from "next/server";
import { authorizeWidgetRequest } from "@/src/lib/chatbot-widget";
import { isWorkspaceOnline } from "@/src/lib/presence";
import { prisma } from "@/src/lib/prisma";
import { createEventStream, subscribeToSession } from "@/src/lib/realtime";
import { runFallbackIfDue, serializeWidgetMessage } from "@/src/lib/widget-conversation";
import {
  loadWidgetSession,
  readWidgetSessionToken,
  serializeWidgetSession,
} from "@/src/lib/widget-session";

export const dynamic = "force-dynamic";

type WidgetStreamRouteContext = {
  params: Promise<{
    widgetId: string;
  }>;
};

/**
 * Live conversation stream for the widget (Server-Sent Events). EventSource cannot
 * send headers, so the embed token and session token come as `?token=` / `?session=`.
 * Emits `message` (new messages) and `session` (status, expiry, operators online).
 */
export async function GET(request: Request, context: WidgetStreamRouteContext) {
  const { widgetId } = await context.params;
  const access = await authorizeWidgetRequest(request, widgetId);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { chatbot } = access;
  const token = readWidgetSessionToken(request);
  const initial = await loadWidgetSession(chatbot, token);

  if (!initial) {
    return NextResponse.json({ error: "No conversation to follow yet." }, { status: 404 });
  }

  const after = new URL(request.url).searchParams.get("after");
  let cursor = after && !Number.isNaN(Date.parse(after)) ? new Date(after) : new Date(0);
  let lastSessionState = "";

  return createEventStream({
    request,
    subscribe: (wake) => subscribeToSession(initial.id, wake),
    poll: async () => {
      const session = await loadWidgetSession(chatbot, token);

      if (!session) {
        return [];
      }

      if (session.status !== "CLOSED") {
        await runFallbackIfDue(chatbot, session.id);
      }

      const messages = await prisma.chatMessage.findMany({
        where: { sessionId: session.id, createdAt: { gt: cursor } },
        orderBy: { createdAt: "asc" },
        take: 50,
      });
      const payloads: Array<{ event: string; data: unknown }> = [];

      if (messages.length > 0) {
        cursor = messages[messages.length - 1].createdAt;
        payloads.push({ event: "message", data: messages.map(serializeWidgetMessage) });
      }

      const state = {
        session: serializeWidgetSession(session),
        operatorsOnline: await isWorkspaceOnline(chatbot.workspaceId),
      };
      const stateKey = `${state.session.status}|${state.session.expiresAt}|${state.operatorsOnline}`;

      if (stateKey !== lastSessionState) {
        lastSessionState = stateKey;
        payloads.push({ event: "session", data: state });
      }

      return payloads;
    },
  });
}
