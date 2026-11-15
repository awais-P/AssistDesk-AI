import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { deliverAgentMessageToChannel } from "@/src/lib/integrations/channel-outbound";
import { EscalationError, acceptEscalation, findOpenEscalation, openEscalation } from "@/src/lib/escalation";
import { prisma } from "@/src/lib/prisma";
import { appendSessionMessage } from "@/src/lib/session-lifecycle";

type ChatSessionMessagesRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/**
 * A team member replies in a chat from the dashboard. The message is pushed live to
 * the widget (SSE) and delivered to Slack/WhatsApp for those channels. Replying takes
 * the conversation over from the AI (status ESCALATED) until it is handed back.
 */
export async function POST(request: Request, context: ChatSessionMessagesRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { content?: unknown };
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!content) {
    return NextResponse.json({ error: "Write a reply before sending." }, { status: 400 });
  }

  if (content.length > 4000) {
    return NextResponse.json(
      { error: "Replies can be up to 4000 characters." },
      { status: 400 },
    );
  }

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
          "This conversation has ended, so the customer would not see a reply here. Their next message starts a new conversation.",
      },
      { status: 409 },
    );
  }

  // Replying takes the conversation over (Module 9: an escalation accepted by this
  // team member) - or accepts the waiting escalation if the AI already handed it over.
  const actor = { id: session.user.id, fullName: session.user.fullName };
  const open = chatSession.status === "ESCALATED" ? await findOpenEscalation(chatSession.workspaceId, { sessionId: chatSession.id }) : null;

  if (chatSession.status === "ACTIVE") {
    await openEscalation({
      workspaceId: chatSession.workspaceId,
      sessionId: chatSession.id,
      contactId: chatSession.contactId,
      trigger: "MANUAL",
      reason: `${session.user.fullName} replied to the customer.`,
      actor,
      customerNotice: null,
      eventDetail: `${session.user.fullName} replied and took over the conversation; AI replies paused.`,
      eventMetadata: { trigger: "reply" },
    }).catch((error) => {
      if (!(error instanceof EscalationError)) throw error;
    });
  } else if (open?.status === "PENDING") {
    await acceptEscalation({ workspaceId: chatSession.workspaceId, escalationId: open.id, actor }).catch(() => undefined);
  }

  const message = await appendSessionMessage({
    sessionId: chatSession.id,
    workspaceId: chatSession.workspaceId,
    sender: "AGENT",
    content,
    authorName: session.user.fullName,
  });

  const delivery = await deliverAgentMessageToChannel(chatSession.id, content);

  return NextResponse.json({
    message: {
      id: message.id,
      sender: message.sender,
      content: message.content,
      authorName: message.authorName,
      attachments: [],
      createdAt: message.createdAt.toISOString(),
    },
    status: "ESCALATED",
    delivery,
  });
}
