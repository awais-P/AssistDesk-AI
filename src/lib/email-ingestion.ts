import { Prisma } from "@/app/generated/prisma/client";
import { resolveContact } from "./contacts";
import { cleanReplySubject, normalizeMessageId, parseTicketReference, stripQuotedReply } from "./email-threading";
import { createNotification } from "./notifications";
import { processIncomingTicket, processTicketFollowUp } from "./ticket-workflow";
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
  messageId?: string | null;
};

export type EmailIngestResult = {
  ticket: { id: string; ticketNumber: number };
  outcome: "created" | "threaded" | "duplicate";
};

function htmlToText(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function emailBody(payload: IncomingEmailPayload) {
  return payload.text?.trim() || (payload.html ? htmlToText(payload.html) : "");
}

function buildTicketPreview(content: string) {
  return content ? content.slice(0, 300) : null;
}

async function nextTicketNumber(workspaceId: string) {
  const lastTicket = await prisma.ticket.findFirst({
    where: { workspaceId },
    orderBy: { ticketNumber: "desc" },
    select: { ticketNumber: true },
  });

  return (lastTicket?.ticketNumber ?? 458102) + 1;
}

const MAX_CREATE_ATTEMPTS = 3;

/**
 * Creates the ticket with its first message. The number is max+1 per workspace, so two
 * emails arriving together can pick the same one: retry on that conflict (BUG-07). A
 * conflict on the message's externalId means the same email was stored meanwhile and
 * is rethrown for the duplicate check.
 */
async function createEmailTicket(input: {
  workspaceId: string;
  inboxId: string | null;
  subject: string;
  previewText: string | null;
  requesterName: string | null;
  requesterEmail: string;
  contactId: string | null;
  content: string;
  externalId: string | null;
}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.ticket.create({
        data: {
          workspaceId: input.workspaceId,
          inboxId: input.inboxId,
          ticketNumber: await nextTicketNumber(input.workspaceId),
          subject: input.subject,
          previewText: input.previewText,
          requesterName: input.requesterName,
          requesterEmail: input.requesterEmail,
          contactId: input.contactId,
          source: "EMAIL",
          status: "OPEN",
          priority: "MEDIUM",
          messages: {
            create: {
              workspaceId: input.workspaceId,
              sender: "USER",
              content: input.content,
              authorName: input.requesterName,
              externalId: input.externalId,
            },
          },
        },
        select: { id: true, ticketNumber: true, subject: true, requesterEmail: true },
      });
    } catch (error) {
      const isConflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      const isDuplicateEmail =
        isConflict &&
        input.externalId !== null &&
        (await prisma.ticketMessage.count({ where: { externalId: input.externalId } })) > 0;

      if (!isConflict || isDuplicateEmail || attempt >= MAX_CREATE_ATTEMPTS) {
        throw error;
      }
    }
  }
}

/**
 * The ticket an email reply belongs to: the `[PREFIX-NUMBER]` reference must name a
 * ticket of this workspace whose prefix matches and whose requester is the sender, so
 * nobody can post into someone else's ticket by guessing a number.
 */
async function findThreadTicket(workspaceId: string, subject: string, fromEmail: string) {
  const reference = parseTicketReference(subject);

  if (!reference) {
    return null;
  }

  const ticket = await prisma.ticket.findFirst({
    where: { workspaceId, ticketNumber: reference.ticketNumber },
    include: { inbox: { select: { ticketPrefix: true } } },
  });
  const prefix = (ticket?.inbox?.ticketPrefix ?? "AD").toUpperCase();

  if (!ticket || prefix !== reference.prefix || ticket.requesterEmail?.toLowerCase() !== fromEmail) {
    return null;
  }

  return ticket;
}

/**
 * Turns an inbound email into ticket activity (Module 5 on the email channel):
 * the sender becomes/links to a Contact, a reply to one of our emails is threaded
 * into its ticket (reopening it if needed), and anything else opens a new ticket.
 * Provider retries with the same Message-ID are ignored.
 */
export async function ingestIncomingEmail({
  integration,
  payload,
}: {
  integration: EmailIntegrationRecord;
  payload: IncomingEmailPayload;
}): Promise<EmailIngestResult> {
  const { workspaceId } = integration;
  const fromEmail = payload.fromEmail.trim().toLowerCase();
  const messageId = normalizeMessageId(payload.messageId);
  const externalId = messageId ? `email:${messageId}` : null;

  if (externalId) {
    const existing = await prisma.ticketMessage.findUnique({
      where: { externalId },
      select: { ticket: { select: { id: true, ticketNumber: true } } },
    });

    if (existing) {
      return { ticket: existing.ticket, outcome: "duplicate" };
    }
  }

  const contact = await resolveContact(
    workspaceId,
    { email: fromEmail, name: payload.fromName ?? null },
    "EMAIL",
  );
  const body = emailBody(payload);
  const threadTicket = await findThreadTicket(workspaceId, payload.subject, fromEmail);

  try {
    if (threadTicket) {
      const reply = stripQuotedReply(body) || cleanReplySubject(payload.subject);
      const reopened = threadTicket.status === "RESOLVED" || threadTicket.status === "CLOSED";

      await prisma.$transaction([
        prisma.ticketMessage.create({
          data: {
            workspaceId,
            ticketId: threadTicket.id,
            sender: "USER",
            content: reply,
            authorName: payload.fromName?.trim() || threadTicket.requesterName,
            externalId,
          },
        }),
        prisma.ticket.update({
          where: { id: threadTicket.id },
          data: {
            ...(reopened ? { status: "OPEN" as const } : {}),
            contactId: threadTicket.contactId ?? contact?.id ?? null,
          },
          select: { id: true },
        }),
        prisma.automationLog.create({
          data: {
            workspaceId,
            ticketId: threadTicket.id,
            action: "EMAIL_INGEST",
            status: "SUCCESS",
            summary: `Customer reply threaded into ticket #${threadTicket.ticketNumber}${reopened ? " (ticket reopened)" : ""} through integration ${integration.id}.`,
          },
        }),
      ]);

      await createNotification({
        workspaceId,
        type: "TICKET_REPLY",
        title: `${reopened ? "Reopened: " : ""}customer replied to ticket #${threadTicket.ticketNumber}`,
        body: `${fromEmail}: ${reply.replace(/\s+/g, " ").slice(0, 140)}`,
        link: `/dashboard/tickets/${threadTicket.id}`,
      });

      return { ticket: threadTicket, outcome: "threaded" };
    }

    const subject = payload.subject.trim();
    const ticket = await createEmailTicket({
      workspaceId,
      inboxId: integration.inboxId,
      subject,
      previewText: buildTicketPreview(body),
      requesterName: payload.fromName?.trim() || null,
      requesterEmail: fromEmail,
      contactId: contact?.id ?? null,
      content: [subject, body].filter(Boolean).join("\n\n"),
      externalId,
    });

    await createNotification({
      workspaceId,
      type: "NEW_TICKET",
      title: `New email ticket #${ticket.ticketNumber}: ${ticket.subject}`,
      body: `From ${ticket.requesterEmail}`,
      link: `/dashboard/tickets/${ticket.id}`,
    });

    await prisma.automationLog.create({
      data: {
        workspaceId,
        ticketId: ticket.id,
        action: "EMAIL_INGEST",
        status: "SUCCESS",
        summary: `Incoming email converted to ticket through integration ${integration.id}.`,
      },
    });

    return { ticket, outcome: "created" };
  } catch (error) {
    // Two deliveries of the same email raced each other: the first one won.
    if (externalId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.ticketMessage.findUnique({
        where: { externalId },
        select: { ticket: { select: { id: true, ticketNumber: true } } },
      });

      if (existing) {
        return { ticket: existing.ticket, outcome: "duplicate" };
      }
    }

    throw error;
  }
}

/** Runs the AI workflow for an ingested email (called after the webhook has answered). */
export async function runEmailAutomation(result: EmailIngestResult) {
  if (result.outcome === "created") {
    await processIncomingTicket(result.ticket.id);
  } else if (result.outcome === "threaded") {
    await processTicketFollowUp(result.ticket.id);
  }
}
