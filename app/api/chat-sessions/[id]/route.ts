import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type ChatSessionRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const allowedStatuses = new Set(["ACTIVE", "ESCALATED", "CLOSED"]);

/**
 * Human takeover controls: ESCALATED pauses the AI so a team member can answer,
 * ACTIVE hands the conversation back to the AI, CLOSED ends it.
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
  const result = await prisma.chatSession.updateMany({
    where: { id, workspaceId: session.user.workspaceId },
    data: { status, endedAt: status === "CLOSED" ? new Date() : null },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const notice =
    status === "ESCALATED"
      ? `${session.user.fullName} joined the conversation.`
      : status === "ACTIVE"
        ? "The AI assistant is back in the conversation."
        : "This conversation was closed.";

  await prisma.chatMessage.create({
    data: { sessionId: id, sender: "SYSTEM", content: notice },
  });

  return NextResponse.json({ success: true, status });
}
