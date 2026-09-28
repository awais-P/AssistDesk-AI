import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { deliverAgentMessageToChannel } from "@/src/lib/integrations/channel-outbound";
import { prisma } from "@/src/lib/prisma";

type ChatSessionMessagesRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/**
 * A team member replies in a chat from the dashboard. The message appears in the
 * widget (which polls) and is delivered to Slack/WhatsApp for those channels.
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
    select: { id: true, status: true },
  });

  if (!chatSession) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const message = await prisma.chatMessage.create({
    data: {
      sessionId: chatSession.id,
      sender: "AGENT",
      content,
      authorName: session.user.fullName,
    },
  });

  await prisma.chatSession.update({
    where: { id: chatSession.id },
    data: { status: chatSession.status === "CLOSED" ? "ACTIVE" : chatSession.status },
    select: { id: true },
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
    delivery,
  });
}
