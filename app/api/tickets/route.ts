import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { processIncomingTicket } from "@/src/lib/ticket-workflow";
import { TicketPriority, TicketSource, TicketStatus } from "@/app/generated/prisma/enums";

type CreateTicketPayload = {
  subject?: string;
  previewText?: string;
  requesterName?: string;
  requesterEmail?: string;
  priority?: keyof typeof TicketPriority;
  status?: keyof typeof TicketStatus;
  source?: keyof typeof TicketSource;
};

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as CreateTicketPayload;
  const subject = body.subject?.trim();

  if (!subject) {
    return NextResponse.json(
      { error: "Ticket subject is required." },
      { status: 400 },
    );
  }

  const inbox = await prisma.inbox.findFirst({
    where: {
      workspaceId: session.user.workspaceId,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const lastTicket = await prisma.ticket.findFirst({
    where: {
      workspaceId: session.user.workspaceId,
    },
    orderBy: {
      ticketNumber: "desc",
    },
    select: {
      ticketNumber: true,
    },
  });

  const nextTicketNumber = (lastTicket?.ticketNumber ?? 458102) + 1;

  const ticket = await prisma.ticket.create({
    data: {
      workspaceId: session.user.workspaceId,
      inboxId: inbox?.id,
      assigneeId: session.user.id,
      createdById: session.user.id,
      ticketNumber: nextTicketNumber,
      subject,
      previewText: body.previewText?.trim() || null,
      requesterName: body.requesterName?.trim() || null,
      requesterEmail: body.requesterEmail?.trim().toLowerCase() || null,
      priority:
        body.priority && body.priority in TicketPriority
          ? body.priority
          : "MEDIUM",
      status:
        body.status && body.status in TicketStatus ? body.status : "OPEN",
      source:
        body.source && body.source in TicketSource ? body.source : "WEB",
    },
  });

  const initialRequest = [subject, body.previewText?.trim()]
    .filter(Boolean)
    .join("\n\n");

  if (initialRequest) {
    await prisma.ticketMessage.create({
      data: {
        workspaceId: session.user.workspaceId,
        ticketId: ticket.id,
        sender: "USER",
        content: initialRequest,
      },
    });
  }

  await processIncomingTicket(ticket.id);

  const processedTicket = await prisma.ticket.findUnique({
    where: {
      id: ticket.id,
    },
    include: {
      inbox: true,
      assignee: true,
      ticketTags: {
        include: {
          tag: true,
        },
      },
    },
  });

  return NextResponse.json({ ticket: processedTicket });
}
