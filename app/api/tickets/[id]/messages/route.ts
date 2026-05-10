import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type TicketMessagesRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type CreateTicketMessagePayload = {
  content?: string;
  mode?: "reply" | "internal";
  closeAfterReply?: boolean;
};

const INTERNAL_NOTE_PREFIX = "[[INTERNAL_NOTE]]";

export async function POST(
  request: Request,
  context: TicketMessagesRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as CreateTicketMessagePayload;
  const content = body.content?.trim();
  const mode = body.mode || "reply";

  if (!content) {
    return NextResponse.json(
      { error: "Message content is required." },
      { status: 400 },
    );
  }

  const ticket = await prisma.ticket.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
      workspaceId: true,
      assigneeId: true,
    },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const storedContent =
    mode === "internal" ? `${INTERNAL_NOTE_PREFIX}\n${content}` : content;

  const message = await prisma.ticketMessage.create({
    data: {
      workspaceId: session.user.workspaceId,
      ticketId: id,
      sender: mode === "reply" ? "AGENT" : "SYSTEM",
      content: storedContent,
    },
  });

  await prisma.ticket.update({
    where: {
      id,
    },
    data: {
      status: body.closeAfterReply ? "CLOSED" : "IN_PROGRESS",
      assigneeId: ticket.assigneeId || session.user.id,
      previewText: content.slice(0, 300),
    },
  });

  await prisma.automationLog.create({
    data: {
      workspaceId: session.user.workspaceId,
      ticketId: id,
      action: mode === "reply" ? "AGENT_REPLY" : "INTERNAL_NOTE",
      status: "SUCCESS",
      summary:
        mode === "reply"
          ? "A manual agent reply was sent on the ticket."
          : "An internal note was added to the ticket.",
    },
  });

  return NextResponse.json({
    message: {
      ...message,
      content,
      mode,
    },
  });
}
