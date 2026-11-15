import { NextResponse } from "next/server";
import { getCurrentSession, isValidEmail } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { TicketNumberConflictError, createTicketWithMessage } from "@/src/lib/ticket-create";
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

function optionalText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

  const initialRequest = [subject, previewText].filter(Boolean).join("\n\n");
  let ticketId = "";

  try {
    ticketId = await createTicketWithMessage({
      workspaceId: session.user.workspaceId,
      subject,
      previewText: previewText || null,
      message: initialRequest,
      requesterName: requesterName || null,
      requesterEmail: requesterEmail || null,
      priority: (body.priority as TicketPriority | undefined) ?? "MEDIUM",
      status: (body.status as TicketStatus | undefined) ?? "OPEN",
      source: (body.source as TicketSource | undefined) ?? "WEB",
      assigneeId: session.user.id,
      createdById: session.user.id,
    });
  } catch (error) {
    if (error instanceof TicketNumberConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    throw error;
  }

  // The AI reply is written in the background so the dialog closes at once (UI-45).
  await processIncomingTicket(ticketId, { deferAiReply: true });

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
