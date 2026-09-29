import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { sendTicketReplyEmail } from "@/src/lib/mailer";
import { prisma } from "@/src/lib/prisma";

type TicketMessagesRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type CreateTicketMessagePayload = {
  content?: unknown;
  mode?: unknown;
  closeAfterReply?: unknown;
};

type ComposerMode = "reply" | "internal";

const INTERNAL_NOTE_PREFIX = "[[INTERNAL_NOTE]]";
const composerModes = new Set<string>(["reply", "internal"]);

export async function POST(
  request: Request,
  context: TicketMessagesRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  let body: CreateTicketMessagePayload;

  try {
    body = (await request.json()) as CreateTicketMessagePayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  const requestedMode = body.mode ?? "reply";

  if (typeof requestedMode !== "string" || !composerModes.has(requestedMode)) {
    return NextResponse.json(
      { error: 'Message mode must be "reply" or "internal".' },
      { status: 400 },
    );
  }

  const mode = requestedMode as ComposerMode;
  const closeAfterReply = mode === "reply" && body.closeAfterReply === true;

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
      authorName: session.user.fullName,
    },
  });

  // Internal notes never touch the ticket itself (BUG-09). Replies move the ticket
  // along but keep previewText: it stays the customer's original issue (DATA-04).
  if (mode === "reply") {
    await prisma.ticket.update({
      where: {
        id,
      },
      data: {
        status: closeAfterReply ? "CLOSED" : "IN_PROGRESS",
        assigneeId: ticket.assigneeId || session.user.id,
      },
    });
  }

  const delivery =
    mode === "reply"
      ? await sendTicketReplyEmail({ ticketId: id, ticketMessageId: message.id, content })
      : null;

  await prisma.automationLog.create({
    data: {
      workspaceId: session.user.workspaceId,
      ticketId: id,
      action: mode === "reply" ? "AGENT_REPLY" : "INTERNAL_NOTE",
      status: delivery && delivery.status !== "SENT" ? delivery.status : "SUCCESS",
      summary:
        mode === "reply"
          ? delivery?.status === "SENT"
            ? `${session.user.fullName} emailed a reply to the requester.`
            : `${session.user.fullName} saved a reply that was not emailed: ${delivery?.error ?? "unknown reason"}`
          : `${session.user.fullName} added an internal note.`,
    },
  });

  return NextResponse.json({
    message: {
      ...message,
      content,
      mode,
      deliveryStatus: delivery?.status ?? null,
      deliveryError: delivery?.error ?? null,
    },
  });
}
