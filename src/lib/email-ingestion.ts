import { processIncomingTicket } from "./ticket-workflow";
import { prisma } from "./prisma";

type EmailIntegrationRecord = {
  id: string;
  workspaceId: string;
  inboxId: string | null;
  supportAddress: string | null;
  forwardingAddress: string | null;
};

type IncomingEmailPayload = {
  fromName?: string | null;
  fromEmail: string;
  subject: string;
  text?: string | null;
  html?: string | null;
};

function buildTicketPreview(payload: IncomingEmailPayload) {
  const content = payload.text?.trim() || payload.html?.trim() || "";
  return content ? content.slice(0, 300) : null;
}

function buildInitialMessage(payload: IncomingEmailPayload) {
  return [payload.subject.trim(), payload.text?.trim() || payload.html?.trim()]
    .filter(Boolean)
    .join("\n\n");
}

export async function createTicketFromIncomingEmail({
  integration,
  payload,
}: {
  integration: EmailIntegrationRecord;
  payload: IncomingEmailPayload;
}) {
  const lastTicket = await prisma.ticket.findFirst({
    where: {
      workspaceId: integration.workspaceId,
    },
    orderBy: {
      ticketNumber: "desc",
    },
    select: {
      ticketNumber: true,
    },
  });

  const nextTicketNumber = (lastTicket?.ticketNumber ?? 458102) + 1;
  const previewText = buildTicketPreview(payload);

  const ticket = await prisma.ticket.create({
    data: {
      workspaceId: integration.workspaceId,
      inboxId: integration.inboxId,
      ticketNumber: nextTicketNumber,
      subject: payload.subject.trim(),
      previewText,
      requesterName: payload.fromName?.trim() || null,
      requesterEmail: payload.fromEmail.trim().toLowerCase(),
      source: "EMAIL",
      status: "OPEN",
      priority: "MEDIUM",
    },
  });

  const initialMessage = buildInitialMessage(payload);

  if (initialMessage) {
    await prisma.ticketMessage.create({
      data: {
        workspaceId: integration.workspaceId,
        ticketId: ticket.id,
        sender: "USER",
        content: initialMessage,
      },
    });
  }

  await prisma.automationLog.create({
    data: {
      workspaceId: integration.workspaceId,
      ticketId: ticket.id,
      action: "EMAIL_INGEST",
      status: "SUCCESS",
      summary: `Incoming email converted to ticket through integration ${integration.id}.`,
    },
  });

  await processIncomingTicket(ticket.id);

  return ticket;
}
