import { createNotification } from "./notifications";
import nodemailer from "nodemailer";
import { mailboxSettings } from "./email-mailbox-settings";
import { readIntegrationConfig } from "./integrations/config";
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

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";

type PlatformEmail = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
  fromAddress?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

function platformFromAddress() {
  return process.env.ASSISTDESK_SMTP_FROM?.trim() || `notifications@${getEmailDomain()}`;
}

function brevoApiKey() {
  return process.env.BREVO_API_KEY?.trim() || null;
}

/**
 * The platform sender is configured when either the Brevo HTTPS API key or the SMTP
 * host is set. Hosts such as Railway (Trial/Hobby) block outgoing SMTP, so production
 * sends through Brevo's HTTPS API; local development keeps using SMTP.
 */
export function isPlatformEmailConfigured() {
  return Boolean(brevoApiKey() || getDefaultSmtp());
}

/**
 * Sends one email from the platform account: Brevo's HTTPS API when `BREVO_API_KEY` is
 * set, otherwise the platform SMTP account. Returns false when neither is configured
 * and throws when the send fails.
 */
async function sendPlatformEmail(message: PlatformEmail): Promise<boolean> {
  const fromName = message.fromName || "AssistDesk";
  const fromAddress = message.fromAddress || platformFromAddress();
  const apiKey = brevoApiKey();

  if (apiKey) {
    const response = await fetch(BREVO_SEND_URL, {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: fromName, email: fromAddress },
        to: message.to.map((email) => ({ email })),
        subject: message.subject,
        textContent: message.text,
        ...(message.html ? { htmlContent: message.html } : {}),
        ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}),
        ...(message.headers ? { headers: message.headers } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(`Brevo refused the email (${response.status}): ${body?.message ?? response.statusText}`);
    }

    return true;
  }

  const smtp = getDefaultSmtp();

  if (!smtp) {
    return false;
  }

  await createTransport(smtp).sendMail({
    from: { name: fromName, address: fromAddress },
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    replyTo: message.replyTo,
    headers: message.headers,
  });

  return true;
}

const NOT_CONFIGURED_ERROR =
  "No platform email sender is configured (BREVO_API_KEY or ASSISTDESK_SMTP_HOST).";

/**
 * Internal notification email to the team (e.g. "New lead", Module 8 FE-3), sent
 * through the platform SMTP account. Returns the delivery status instead of throwing.
 */
export async function sendTeamEmail({
  to,
  subject,
  text,
}: {
  to: string[];
  subject: string;
  text: string;
}): Promise<{ status: EmailDeliveryStatus; error: string | null }> {
  const recipients = to.map((address) => address.trim()).filter(Boolean);

  if (recipients.length === 0) {
    return { status: "NO_RECIPIENT", error: "No recipients." };
  }

  try {
    const sent = await sendPlatformEmail({ to: recipients, subject: subject.slice(0, 200), text });
    return sent ? { status: "SENT", error: null } : { status: "NOT_CONFIGURED", error: NOT_CONFIGURED_ERROR };
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 300) : "Send failed." };
  }
}

/**
 * Sends a confirmation/verification email to a newly signed up user with a link
 * to verify their email address.
 */
export async function sendVerificationEmail({
  email,
  fullName,
  verificationToken,
}: {
  email: string;
  fullName: string;
  verificationToken: string;
}): Promise<{ status: EmailDeliveryStatus; error: string | null; verifyUrl: string }> {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(verificationToken)}`;
  try {
    const sent = await sendPlatformEmail({
      to: [email.trim()],
      subject: "Verify your AssistDesk account",
      text: `Hi ${fullName},\n\nWelcome to AssistDesk! Please verify your email address by opening the following link in your browser:\n\n${verifyUrl}\n\nThis verification link expires in 24 hours.\n\nIf you did not sign up for AssistDesk, you can safely ignore this email.`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1e293b;">
          <h2 style="color: #0f172a; margin-bottom: 16px;">Verify your AssistDesk account</h2>
          <p>Hi ${fullName},</p>
          <p>Welcome to AssistDesk! Please verify your email address to confirm your account and sign in.</p>
          <p style="margin: 28px 0;">
            <a href="${verifyUrl}" style="background-color: #0284c7; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">Verify Email Address</a>
          </p>
          <p style="color: #64748b; font-size: 14px; line-height: 1.5;">Or copy and paste this URL into your browser:<br/><a href="${verifyUrl}" style="color: #0284c7; word-break: break-all;">${verifyUrl}</a></p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0;" />
          <p style="color: #94a3b8; font-size: 12px;">This link will expire in 24 hours. If you did not create this account, please ignore this email.</p>
        </div>
      `,
    });

    if (!sent) {
      return { status: "NOT_CONFIGURED", error: NOT_CONFIGURED_ERROR, verifyUrl };
    }

    return { status: "SENT", error: null, verifyUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Send failed.";
    console.error(`[mailer] Failed to send verification email to ${email}: ${message}`);
    return { status: "FAILED", error: message.slice(0, 300), verifyUrl };
  }
}

/**
 * Sends a password reset email to a user with a secure reset link.
 */
export async function sendPasswordResetEmail({
  email,
  fullName,
  resetToken,
}: {
  email: string;
  fullName: string;
  resetToken: string;
}): Promise<{ status: EmailDeliveryStatus; error: string | null; resetUrl: string }> {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
  try {
    const sent = await sendPlatformEmail({
      to: [email.trim()],
      subject: "Reset your AssistDesk password",
      text: `Hi ${fullName},\n\nWe received a request to reset your AssistDesk password. Click the link below to choose a new password:\n\n${resetUrl}\n\nThis password reset link will expire in 1 hour.\n\nIf you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1e293b;">
          <h2 style="color: #0f172a; margin-bottom: 16px;">Reset your AssistDesk password</h2>
          <p>Hi ${fullName},</p>
          <p>We received a request to reset the password for your AssistDesk account. Click the button below to set a new password:</p>
          <p style="margin: 28px 0;">
            <a href="${resetUrl}" style="background-color: #0284c7; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">Reset Password</a>
          </p>
          <p style="color: #64748b; font-size: 14px; line-height: 1.5;">Or copy and paste this URL into your browser:<br/><a href="${resetUrl}" style="color: #0284c7; word-break: break-all;">${resetUrl}</a></p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0;" />
          <p style="color: #94a3b8; font-size: 12px;">This password reset link will expire in 1 hour. If you did not make this request, your account is safe and you can safely ignore this email.</p>
        </div>
      `,
    });

    if (!sent) {
      return { status: "NOT_CONFIGURED", error: NOT_CONFIGURED_ERROR, resetUrl };
    }

    return { status: "SENT", error: null, resetUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Send failed.";
    console.error(`[mailer] Failed to send password reset email to ${email}: ${message}`);
    return { status: "FAILED", error: message.slice(0, 300), resetUrl };
  }
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
      workspaceId: true,
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
            select: { supportAddress: true, provider: true, config: true },
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
    const connection = inbox?.integrations[0];
    // A Gmail mailbox connection sends from that same mailbox, so the customer's reply
    // lands where AssistDesk reads it.
    const mailbox = connection
      ? mailboxSettings(connection.provider, readIntegrationConfig("EMAIL", connection.config))
      : null;
    // An inbox's own SMTP account or Gmail connection sends itself; otherwise the
    // platform sender (Brevo or SMTP) is used.
    const ownSmtp: SmtpSettings | null = inbox?.smtpHost
      ? {
          host: inbox.smtpHost,
          port: inbox.smtpPort || 587,
          secure: inbox.smtpSecure,
          user: inbox.smtpUser,
          password: decryptSecret(inbox.smtpPassword),
        }
      : mailbox
        ? { host: mailbox.smtpHost, port: mailbox.smtpPort, secure: true, user: mailbox.user, password: mailbox.password }
        : null;

    if (!ownSmtp && !isPlatformEmailConfigured()) {
      result = {
        status: "NOT_CONFIGURED",
        error:
          "No email sender is configured. Add one under Inboxes → Email sender, or set BREVO_API_KEY or ASSISTDESK_SMTP_HOST.",
      };
    } else {
      const inboxAddress = `${inbox?.emailPrefix ?? "support"}@${getEmailDomain()}`;
      // A custom inbox SMTP account sends as the inbox's own sender address. The shared
      // platform account can only send from its verified address, so replies go to the inbox.
      const fromAddress = inbox?.smtpHost
        ? inbox.senderEmail || inbox.smtpUser || inboxAddress
        : mailbox
          ? mailbox.user
          : process.env.ASSISTDESK_SMTP_FROM?.trim() || inboxAddress;
      // Customer replies should reach the address that feeds the email integration.
      const connectedSupportAddress = connection?.supportAddress ?? null;
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
        const subject = `Re: ${ticket.subject} [${reference}]`;
        const headers = { "X-AssistDesk-Ticket": reference };

        if (ownSmtp) {
          await createTransport(ownSmtp).sendMail({
            from: { name: fromName, address: fromAddress },
            to: ticket.requesterEmail,
            replyTo: replyToAddress,
            subject,
            text,
            headers,
          });
        } else {
          await sendPlatformEmail({
            to: [ticket.requesterEmail],
            subject,
            text,
            fromName,
            fromAddress,
            replyTo: replyToAddress,
            headers,
          });
        }
        result = { status: "SENT", error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[mailer] Failed to send ticket ${reference}: ${message}`);
        result = { status: "FAILED", error: message.slice(0, 300) };
        await createNotification({
          workspaceId: ticket.workspaceId,
          type: "EMAIL_DELIVERY_FAILED",
          severity: "ERROR",
          title: `Reply to ${ticket.requesterEmail} was not delivered`,
          body: message.slice(0, 300),
          link: `/dashboard/tickets/${ticketId}`,
        });
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
