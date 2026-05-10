import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { createTicketFromIncomingEmail } from "@/src/lib/email-ingestion";

type IncomingEmailPayload = {
  supportAddress?: string;
  forwardingAddress?: string;
  fromName?: string | null;
  fromEmail?: string;
  subject?: string;
  text?: string | null;
  html?: string | null;
  secret?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as IncomingEmailPayload;
  const supportAddress = body.supportAddress?.trim().toLowerCase() || "";
  const forwardingAddress = body.forwardingAddress?.trim().toLowerCase() || "";
  const fromEmail = body.fromEmail?.trim().toLowerCase() || "";
  const subject = body.subject?.trim() || "";
  const secret =
    body.secret?.trim() || request.headers.get("x-assistdesk-secret") || "";

  const integrationFilters: Array<
    | { supportAddress: string }
    | { forwardingAddress: string }
    | { webhookSecret: string }
  > = [];

  if (supportAddress) {
    integrationFilters.push({ supportAddress });
  }

  if (forwardingAddress) {
    integrationFilters.push({ forwardingAddress });
  }

  if (secret) {
    integrationFilters.push({ webhookSecret: secret });
  }

  if (!fromEmail || !subject) {
    return NextResponse.json(
      { error: "fromEmail and subject are required." },
      { status: 400 },
    );
  }

  const integration = await prisma.integration.findFirst({
    where: {
      type: "EMAIL",
      isActive: true,
      status: "CONNECTED",
      OR: integrationFilters,
    },
    select: {
      id: true,
      workspaceId: true,
      inboxId: true,
      supportAddress: true,
      forwardingAddress: true,
    },
  });

  if (!integration) {
    return NextResponse.json(
      { error: "No matching active email integration was found." },
      { status: 404 },
    );
  }

  const ticket = await createTicketFromIncomingEmail({
    integration,
    payload: {
      fromName: body.fromName || null,
      fromEmail,
      subject,
      text: body.text || null,
      html: body.html || null,
    },
  });

  return NextResponse.json({
    success: true,
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
  });
}
