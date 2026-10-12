import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { getCurrentSession, isValidEmail } from "@/src/lib/auth";
import { findOrCreateContactByEmail } from "@/src/lib/contacts";
import { prisma } from "@/src/lib/prisma";
import { processIncomingTicket } from "@/src/lib/ticket-workflow";
import {
  TicketPriority,
  TicketSource,
  TicketStatus,
} from "@/app/generated/prisma/enums";

type CreateTicketPayload = {
  subject?: unknown;
  previewText?: unknown;
  requesterName?: unknown;
  requesterEmail?: unknown;
  priority?: unknown;
  status?: unknown;
  source?: unknown;
};

const priorityValues = new Set<string>(Object.values(TicketPriority));
const statusValues = new Set<string>(Object.values(TicketStatus));
const sourceValues = new Set<string>(Object.values(TicketSource));

const FIRST_TICKET_NUMBER = 458103;
const MAX_CREATE_ATTEMPTS = 3;

function optionalText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isTicketNumberConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: CreateTicketPayload;

  try {
    body = (await request.json()) as CreateTicketPayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const subject = optionalText(body.subject);
  const previewText = optionalText(body.previewText);
  const requesterName = optionalText(body.requesterName);
  const requesterEmail = optionalText(body.requesterEmail).toLowerCase();

  if (!subject) {
    return NextResponse.json(
      { error: "Ticket subject is required." },
      { status: 400 },
    );
  }

  if (requesterEmail && !isValidEmail(requesterEmail)) {
    return NextResponse.json(
      { error: "Enter a valid requester email address, or leave it empty." },
      { status: 400 },
    );
  }

  for (const [field, value, allowed] of [
    ["priority", body.priority, priorityValues],
    ["status", body.status, statusValues],
    ["source", body.source, sourceValues],
  ] as const) {
    if (value !== undefined && (typeof value !== "string" || !allowed.has(value))) {
      return NextResponse.json(
        { error: `Unknown ticket ${field} "${String(value)}".` },
        { status: 400 },
      );
    }
  }

  const inbox = await prisma.inbox.findFirst({
    where: {
      workspaceId: session.user.workspaceId,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
    },
  });

  let ticketId = "";

  // ticketNumber is max+1 per workspace; two creates at the same moment can pick the
  // same number, so retry on the unique-constraint error instead of failing (BUG-07).
  // Module 5: the requester's Contact links this ticket to their chats on other channels.
  const contact = requesterEmail
    ? await findOrCreateContactByEmail(session.user.workspaceId, requesterEmail, requesterName)
    : null;

  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS && !ticketId; attempt += 1) {
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

    try {
      const ticket = await prisma.ticket.create({
        data: {
          workspaceId: session.user.workspaceId,
          inboxId: inbox?.id,
          assigneeId: session.user.id,
          createdById: session.user.id,
          ticketNumber: lastTicket ? lastTicket.ticketNumber + 1 : FIRST_TICKET_NUMBER,
          subject,
          previewText: previewText || null,
          requesterName: requesterName || null,
          requesterEmail: requesterEmail || null,
          contactId: contact?.id ?? null,
          priority: (body.priority as TicketPriority | undefined) ?? "MEDIUM",
          status: (body.status as TicketStatus | undefined) ?? "OPEN",
          source: (body.source as TicketSource | undefined) ?? "WEB",
        },
        select: {
          id: true,
        },
      });

      ticketId = ticket.id;
    } catch (error) {
      if (!isTicketNumberConflict(error)) {
        throw error;
      }

      if (attempt === MAX_CREATE_ATTEMPTS) {
        return NextResponse.json(
          { error: "Several tickets were created at once. Please try again." },
          { status: 409 },
        );
      }
    }
  }

  const initialRequest = [subject, previewText].filter(Boolean).join("\n\n");

  await prisma.ticketMessage.create({
    data: {
      workspaceId: session.user.workspaceId,
      ticketId,
      sender: "USER",
      content: initialRequest,
      authorName: requesterName || null,
    },
  });

  await processIncomingTicket(ticketId);

  const processedTicket = await prisma.ticket.findUnique({
    where: {
      id: ticketId,
    },
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      previewText: true,
      requesterName: true,
      requesterEmail: true,
      source: true,
      status: true,
      priority: true,
      createdAt: true,
      inbox: {
        select: {
          id: true,
          name: true,
        },
      },
      assignee: {
        select: {
          id: true,
          fullName: true,
        },
      },
      ticketTags: {
        select: {
          tag: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  return NextResponse.json({ ticket: processedTicket });
}
