import { NextResponse } from "next/server";
import { authorizeWidgetRequest } from "@/src/lib/chatbot-widget";
import { closeSession } from "@/src/lib/session-lifecycle";
import {
  loadWidgetSession,
  readWidgetSessionToken,
  serializeWidgetSession,
} from "@/src/lib/widget-session";

type WidgetSessionRouteContext = {
  params: Promise<{
    widgetId: string;
  }>;
};

/** The visitor ends the conversation ("End chat" in the widget). */
export async function DELETE(request: Request, context: WidgetSessionRouteContext) {
  const { widgetId } = await context.params;
  const access = await authorizeWidgetRequest(request, widgetId);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const session = await loadWidgetSession(access.chatbot, readWidgetSessionToken(request));

  if (!session) {
    return NextResponse.json({ error: "No active conversation." }, { status: 404 });
  }

  if (session.status !== "CLOSED") {
    await closeSession(session.id, "CLOSED_BY_CUSTOMER");
  }

  const closed = await loadWidgetSession(access.chatbot, readWidgetSessionToken(request));

  return NextResponse.json({ session: closed ? serializeWidgetSession(closed) : null });
}
