import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { publishConversationEvent } from "@/src/lib/realtime";
import { appendSessionMessage, closeSession, recordSessionEvent } from "@/src/lib/session-lifecycle";

type ChatSessionRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const allowedStatuses = new Set(["ACTIVE", "ESCALATED", "CLOSED"]);

/**
 * Human takeover controls (Module 5 reply modes): ESCALATED pauses the AI so a team
 * member can answer, ACTIVE hands the conversation back to the AI, CLOSED ends it.
 * A closed session is final — the customer's next message starts a new session that
 * carries the context over — so it cannot be reopened here.
 */
export async function PATCH(request: Request, context: ChatSessionRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { status?: unknown };

  if (typeof body.status !== "string" || !allowedStatuses.has(body.status)) {
    return NextResponse.json(
      { error: "Status must be ACTIVE, ESCALATED or CLOSED." },
      { status: 400 },
    );
  }

  const status = body.status as "ACTIVE" | "ESCALATED" | "CLOSED";
  const chatSession = await prisma.chatSession.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    select: { id: true, status: true, contactId: true, workspaceId: true },
  });

  if (!chatSession) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  if (chatSession.status === "CLOSED") {
    return NextResponse.json(
      {
        error:
          "This conversation has ended. When the customer writes again a new conversation starts with the same context.",
      },
      { status: 409 },
    );
  }

  if (chatSession.status === status) {
    return NextResponse.json({ success: true, status });
  }

  if (status === "CLOSED") {
    await closeSession(chatSession.id, "CLOSED_BY_AGENT", { actorName: session.user.fullName });
    return NextResponse.json({ success: true, status });
  }

  await prisma.chatSession.update({
    where: { id: chatSession.id },
    data: { status },
    select: { id: true },
  });

  await recordSessionEvent({
    workspaceId: chatSession.workspaceId,
    sessionId: chatSession.id,
    contactId: chatSession.contactId,
    type: status === "ESCALATED" ? "HUMAN_TAKEOVER" : "AI_RESUMED",
    detail:
      status === "ESCALATED"
        ? `${session.user.fullName} took over the conversation; AI replies paused.`
        : `${session.user.fullName} handed the conversation back to the AI.`,
    metadata: { userId: session.user.id },
  });

  await appendSessionMessage({
    sessionId: chatSession.id,
    workspaceId: chatSession.workspaceId,
    sender: "SYSTEM",
    content:
      status === "ESCALATED"
        ? `${session.user.fullName} joined the conversation.`
        : "The AI assistant is back in the conversation.",
  });

  publishConversationEvent({ workspaceId: chatSession.workspaceId, sessionId: chatSession.id, type: "status" });

  return NextResponse.json({ success: true, status });
}
