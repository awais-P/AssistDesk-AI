import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { RATE_LIMITS, consumeRateLimit, tooManyRequests } from "@/src/lib/rate-limit";
import { refreshContactMemory, refreshSessionSummary } from "@/src/lib/session-memory";

type ChatSessionSummaryRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/**
 * "Summarise now" from the dashboard: rewrites the session summary from the whole
 * conversation and, for a closed session, the customer's cross-channel memory.
 */
export async function POST(_request: Request, context: ChatSessionSummaryRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const limit = await consumeRateLimit(`ai-test:${session.user.id}`, RATE_LIMITS.aiTestPerUser);

  if (!limit.allowed) {
    return tooManyRequests(limit, "Too many AI requests.");
  }

  const { id } = await context.params;
  const chatSession = await prisma.chatSession.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    select: { id: true, status: true, contactId: true },
  });

  if (!chatSession) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const summary = await refreshSessionSummary(chatSession.id, { final: true });
  const memory =
    chatSession.status === "CLOSED" && chatSession.contactId
      ? await refreshContactMemory(chatSession.contactId)
      : null;

  if (!summary) {
    return NextResponse.json(
      { error: "There is nothing to summarise yet — the customer has not written anything." },
      { status: 400 },
    );
  }

  return NextResponse.json({ summary, memory });
}
