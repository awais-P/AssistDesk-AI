import nodemailer from "nodemailer";
import { prisma } from "./prisma";
import { decryptSecret } from "./secrets";

export type EmailDeliveryStatus = "SENT" | "FAILED" | "NOT_CONFIGURED" | "NO_RECIPIENT";

type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
};

function getDefaultSmtp(): SmtpSettings | null {
  const host = process.env.ASSISTDESK_SMTP_HOST?.trim();

  if (!host) {
    return null;
  }

  const port = Number(process.env.ASSISTDESK_SMTP_PORT || 587);

  return {
    host,
    port,
    secure: process.env.ASSISTDESK_SMTP_SECURE
      ? process.env.ASSISTDESK_SMTP_SECURE === "true"
      : port === 465,
    user: process.env.ASSISTDESK_SMTP_USER?.trim() || null,
    password: process.env.ASSISTDESK_SMTP_PASSWORD || null,
  };
}

export function getEmailDomain() {
  return process.env.ASSISTDESK_EMAIL_DOMAIN?.trim() || "assistdesk.ai";
}

function createTransport(settings: SmtpSettings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.user ? { user: settings.user, pass: settings.password ?? "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/** Verifies SMTP credentials before an admin saves them (FR-15.6). */
export async function verifySmtpSettings(settings: SmtpSettings) {
  await createTransport(settings).verify();
}

/**
 * Emails a ticket reply to the requester, using the inbox's own SMTP sender when
 * configured (FR-15.6) or the platform SMTP account otherwise (FR-15.7).
 */
export async function sendTicketReplyEmail({
  ticketId,
  ticketMessageId,
  content,
}: {
  ticketId: string;
  ticketMessageId: string;
  content: string;
}): Promise<{ status: EmailDeliveryStatus; error: string | null }> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      subject: true,
      ticketNumber: true,
      requesterEmail: true,
      requesterName: true,
      workspace: {
        select: { name: true, settings: { select: { supportSignature: true } } },
      },
      inbox: {
        omit: { smtpPassword: false },
        include: {
          integrations: {
            where: { type: "EMAIL", isActive: true, supportAddress: { not: null } },
            select: { supportAddress: true },
            take: 1,
          },
        },
      },
    },
  });

  let result: { status: EmailDeliveryStatus; error: string | null };

  if (!ticket?.requesterEmail) {
    result = { status: "NO_RECIPIENT", error: "This ticket has no requester email." };
  } else {
    const inbox = ticket.inbox;
    const smtp: SmtpSettings | null = inbox?.smtpHost
      ? {
          host: inbox.smtpHost,
          port: inbox.smtpPort || 587,
          secure: inbox.smtpSecure,
          user: inbox.smtpUser,
          password: decryptSecret(inbox.smtpPassword),
        }
      : getDefaultSmtp();

    if (!smtp) {
      result = {
        status: "NOT_CONFIGURED",
        error:
          "No SMTP sender is configured. Add one under Inboxes → Email sender, or set ASSISTDESK_SMTP_HOST.",
      };
    } else {
      const inboxAddress = `${inbox?.emailPrefix ?? "support"}@${getEmailDomain()}`;
      // A custom inbox SMTP account sends as the inbox's own sender address. The shared
      // platform account can only send from its verified address, so replies go to the inbox.
      const fromAddress = inbox?.smtpHost
        ? inbox.senderEmail || inbox.smtpUser || inboxAddress
        : process.env.ASSISTDESK_SMTP_FROM?.trim() || inboxAddress;
      // Customer replies should reach the address that feeds the email integration.
      const connectedSupportAddress = inbox?.integrations[0]?.supportAddress ?? null;
      const replyToAddress =
        connectedSupportAddress ||
        (inbox?.smtpHost ? fromAddress : inbox?.senderEmail || inboxAddress);
      const fromName = inbox?.senderName || inbox?.name || ticket.workspace.name;
      const reference = `${inbox?.ticketPrefix ?? "AD"}-${ticket.ticketNumber}`;
      const signature = ticket.workspace.settings?.supportSignature?.trim();
      const text = [
        ticket.requesterName ? `Hi ${ticket.requesterName},` : null,
        content,
        signature ? `--\n${signature}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      try {
        await createTransport(smtp).sendMail({
          from: { name: fromName, address: fromAddress },
          to: ticket.requesterEmail,
          replyTo: replyToAddress,
          subject: `Re: ${ticket.subject} [${reference}]`,
          text,
          headers: { "X-AssistDesk-Ticket": reference },
        });
        result = { status: "SENT", error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[mailer] Failed to send ticket ${reference}: ${message}`);
        result = { status: "FAILED", error: message.slice(0, 300) };
      }
    }
  }

  await prisma.ticketMessage.update({
    where: { id: ticketMessageId },
    data: { deliveryStatus: result.status, deliveryError: result.error },
    select: { id: true },
  });

  return result;
}
