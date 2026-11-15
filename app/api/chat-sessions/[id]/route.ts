import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { EscalationError, findOpenEscalation, openEscalation, resolveEscalation } from "@/src/lib/escalation";
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
 * Human takeover controls (Module 5 reply modes, Module 9 escalation): ESCALATED pauses
 * the AI so a team member can answer (an escalation accepted by them), ACTIVE hands the
 * conversation back to the AI (resolving the escalation), CLOSED ends it. A closed
 * session is final — the customer's next message starts a new session that carries the
 * context over — so it cannot be reopened here.
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

  const actor = { id: session.user.id, fullName: session.user.fullName };

  try {
    if (status === "CLOSED") {
      // closeSession also resolves an open escalation of this conversation.
      await closeSession(chatSession.id, "CLOSED_BY_AGENT", { actorName: session.user.fullName });
      return NextResponse.json({ success: true, status });
    }

    if (status === "ESCALATED") {
      await openEscalation({
        workspaceId: chatSession.workspaceId,
        sessionId: chatSession.id,
        contactId: chatSession.contactId,
        trigger: "MANUAL",
        reason: `${session.user.fullName} took over the conversation.`,
        actor,
        customerNotice: `${session.user.fullName} joined the conversation.`,
        eventDetail: `${session.user.fullName} took over the conversation; AI replies paused.`,
      });
      return NextResponse.json({ success: true, status });
    }

    const open = await findOpenEscalation(chatSession.workspaceId, { sessionId: chatSession.id });

    if (open) {
      await resolveEscalation({ workspaceId: chatSession.workspaceId, escalationId: open.id, actor, outcome: "HANDED_BACK" });
      return NextResponse.json({ success: true, status });
    }
  } catch (error) {
    if (error instanceof EscalationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  // Escalated before Module 9 (no escalation record): hand back directly.
  await prisma.chatSession.update({
    where: { id: chatSession.id },
    data: { status: "ACTIVE" },
    select: { id: true },
  });

  await recordSessionEvent({
    workspaceId: chatSession.workspaceId,
    sessionId: chatSession.id,
    contactId: chatSession.contactId,
    type: "AI_RESUMED",
    detail: `${session.user.fullName} handed the conversation back to the AI.`,
    metadata: { userId: session.user.id },
  });

  await appendSessionMessage({
    sessionId: chatSession.id,
    workspaceId: chatSession.workspaceId,
    sender: "SYSTEM",
    content: "The AI assistant is back in the conversation.",
  });

  publishConversationEvent({ workspaceId: chatSession.workspaceId, sessionId: chatSession.id, type: "status" });

  return NextResponse.json({ success: true, status });
}
