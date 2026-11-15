import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { Prisma } from "@/app/generated/prisma/client";
import { ingestIncomingEmail, runEmailAutomation } from "./email-ingestion";
import { type MailboxSettings, MAILBOX_PROVIDERS, mailboxSettings } from "./email-mailbox-settings";
import { readIntegrationConfig } from "./integrations/config";
import { createNotification } from "./notifications";
import { prisma } from "./prisma";

/**
 * Email by mailbox (Module 1 omnichannel, FR-15): AssistDesk reads new mail from the
 * business's own mailbox (Gmail) over IMAP every POLL seconds, so customers simply email
 * that address: no forwarding service or public URL is needed, also on localhost. Each
 * email becomes a ticket, or joins its ticket when the subject has the [PREFIX-123]
 * reference, and the AI workflow runs as for the inbound webhook. Replies are sent from
 * the same mailbox (mailer.ts).
 *
 * Only mail that arrives after the mailbox was connected is read (a UID cursor stored in
 * the integration's config), so an existing inbox is never imported; reading mail in
 * Gmail does not matter. Automatic mail (bounces, auto-replies, newsletters, the
 * mailbox's own messages) is skipped so the AI never answers a robot.
 */

const POLL_SECONDS = Math.max(10, Number(process.env.ASSISTDESK_EMAIL_POLL_SECONDS) || 30);
const MAX_EMAILS_PER_CHECK = 20;

type MailboxIntegration = {
  id: string;
  workspaceId: string;
  inboxId: string | null;
  name: string;
  provider: string;
  supportAddress: string | null;
  forwardingAddress: string | null;
  config: Prisma.JsonValue;
};

/** Why an email is automatic and must not create a ticket, or null for a person's email. */
export function automatedEmailReason({
  fromEmail,
  mailbox,
  headers,
}: {
  fromEmail: string;
  mailbox: string;
  headers: Map<string, unknown>;
}) {
  const header = (name: string) => {
    const value = headers.get(name);
    return typeof value === "string" ? value.toLowerCase() : value ? String(value).toLowerCase() : "";
  };

  if (!fromEmail) {
    return "no sender address";
  }

  if (fromEmail === mailbox) {
    return "sent by the support mailbox itself";
  }

  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?)([+.-]|@)/.test(fromEmail)) {
    return "sent by an automatic address";
  }

  const autoSubmitted = header("auto-submitted");

  if (autoSubmitted && autoSubmitted !== "no") {
    return "an automatic reply";
  }

  if (/^(bulk|junk|list|auto_reply)$/.test(header("precedence")) || headers.has("x-autoreply") || headers.has("x-autorespond")) {
    return "an automatic or bulk email";
  }

  if (headers.has("list-id") || headers.has("list-unsubscribe")) {
    return "a mailing list or newsletter";
  }

  return null;
}

/**
 * Where reading continues: after the stored UID, unless the mailbox was replaced
 * (another address, or a new UIDVALIDITY), when it restarts at the newest message.
 */
export function mailboxCursor(
  stored: { mailbox?: string; uidValidity?: string; lastUid?: string },
  current: { mailbox: string; uidValidity: string; uidNext: number },
) {
  const lastUid = Number(stored.lastUid);

  if (stored.mailbox !== current.mailbox || stored.uidValidity !== current.uidValidity || !Number.isFinite(lastUid)) {
    return { lastUid: Math.max(0, current.uidNext - 1), reset: true };
  }

  return { lastUid, reset: false };
}

function createClient(settings: MailboxSettings) {
  return new ImapFlow({
    host: settings.imapHost,
    port: settings.imapPort,
    secure: true,
    auth: { user: settings.user, pass: settings.password },
    logger: false,
    connectionTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

/** Logs in and opens INBOX; used when an admin saves the connection. */
export async function testMailbox(settings: MailboxSettings) {
  const client = createClient(settings);
  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");
    lock.release();
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export function describeMailboxError(error: unknown) {
  const failed = error as { authenticationFailed?: boolean; responseText?: string; message?: string };

  if (failed?.authenticationFailed) {
    return "Gmail refused the login. Use an App Password (Google Account → Security → App passwords), not your normal password.";
  }

  return (failed?.responseText || failed?.message || "Could not reach the mailbox.").slice(0, 200);
}

async function saveCursor(integrationId: string, cursor: { mailbox: string; uidValidity: string; lastUid: number }) {
  // Re-read so a change saved by an admin meanwhile (e.g. a new password) is kept.
  const fresh = await prisma.integration.findUnique({ where: { id: integrationId }, select: { config: true } });
  const config = fresh?.config && typeof fresh.config === "object" && !Array.isArray(fresh.config) ? fresh.config : {};

  await prisma.integration.update({
    where: { id: integrationId },
    data: {
      lastSyncedAt: new Date(),
      config: {
        ...(config as Record<string, unknown>),
        mailboxCursorAddress: cursor.mailbox,
        mailboxUidValidity: cursor.uidValidity,
        mailboxLastUid: String(cursor.lastUid),
      } as Prisma.InputJsonValue,
    },
  });
}

/** Reads the new mail of one mailbox connection and turns it into tickets. */
export async function checkMailbox(integration: MailboxIntegration) {
  const config = readIntegrationConfig("EMAIL", integration.config);
  const settings = mailboxSettings(integration.provider, config);

  if (!settings) {
    return { received: 0 };
  }

  const client = createClient(settings);
  const fetched: Array<{ uid: number; source: Buffer }> = [];
  let cursor = { mailbox: settings.user, uidValidity: "", lastUid: 0 };

  try {
    await client.connect();
  } catch (error) {
    if ((error as { authenticationFailed?: boolean })?.authenticationFailed) {
      // A wrong password stays wrong: stop checking (Gmail may lock the account) until it is fixed.
      const message = describeMailboxError(error);
      await prisma.integration.update({ where: { id: integration.id }, data: { status: "ERROR", statusMessage: message } });
      await createNotification({
        workspaceId: integration.workspaceId,
        type: "INTEGRATION_ERROR",
        severity: "ERROR",
        title: `${integration.name} stopped receiving email`,
        body: message,
        link: "/dashboard/integrations",
        dedupeMinutes: 60,
      });
      return { received: 0 };
    }

    throw error;
  }

  try {
    const lock = await client.getMailboxLock("INBOX");

    try {
      const mailbox = client.mailbox;

      if (!mailbox) {
        return { received: 0 };
      }

      const current = { mailbox: settings.user, uidValidity: String(mailbox.uidValidity), uidNext: mailbox.uidNext };
      const position = mailboxCursor(
        { mailbox: config.mailboxCursorAddress, uidValidity: config.mailboxUidValidity, lastUid: config.mailboxLastUid },
        current,
      );
      cursor = { mailbox: current.mailbox, uidValidity: current.uidValidity, lastUid: position.lastUid };

      if (position.reset) {
        await saveCursor(integration.id, cursor);
        return { received: 0 };
      }

      if (current.uidNext - 1 > position.lastUid) {
        for await (const message of client.fetch(`${position.lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
          if (message.uid > position.lastUid && message.source) {
            fetched.push({ uid: message.uid, source: message.source });
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  let received = 0;

  for (const { uid, source } of fetched.sort((a, b) => a.uid - b.uid).slice(0, MAX_EMAILS_PER_CHECK)) {
    try {
      const mail = await simpleParser(source);
      const sender = mail.from?.value[0];
      const fromEmail = sender?.address?.trim().toLowerCase() ?? "";
      const skip = automatedEmailReason({ fromEmail, mailbox: settings.user, headers: mail.headers });

      if (skip) {
        console.info(`[email] ${integration.name}: skipped email ${uid} (${skip}).`);
      } else {
        const result = await ingestIncomingEmail({
          integration,
          payload: {
            fromName: sender?.name || null,
            fromEmail,
            subject: mail.subject?.trim() || "(no subject)",
            text: mail.text || null,
            html: typeof mail.html === "string" ? mail.html : null,
            messageId: mail.messageId || null,
          },
        });
        received += result.outcome === "duplicate" ? 0 : 1;
        console.info(`[email] ${integration.name}: email from ${fromEmail} → ticket #${result.ticket.ticketNumber} (${result.outcome}).`);
        await runEmailAutomation(result).catch((error) => console.error("[email] AI workflow failed:", error));
      }
    } catch (error) {
      console.error(`[email] ${integration.name}: could not process email ${uid}:`, error);
    }

    // Move past this email even if it failed, so one broken message cannot block the inbox.
    cursor = { ...cursor, lastUid: uid };
    await saveCursor(integration.id, cursor);
  }

  return { received };
}

/** One pass over every connected mailbox. */
export async function checkAllMailboxes() {
  const integrations = await prisma.integration.findMany({
    where: { type: "EMAIL", isActive: true, status: "CONNECTED", provider: { in: Object.keys(MAILBOX_PROVIDERS) } },
    select: {
      id: true,
      workspaceId: true,
      inboxId: true,
      name: true,
      provider: true,
      supportAddress: true,
      forwardingAddress: true,
      config: true,
    },
  });

  for (const integration of integrations) {
    try {
      await checkMailbox(integration);
    } catch (error) {
      console.error(`[email] ${integration.name}: mailbox check failed: ${describeMailboxError(error)}`);
    }
  }
}

declare global {
  var assistdeskEmailPoller: ReturnType<typeof setInterval> | undefined;
}

/**
 * Starts checking connected mailboxes every POLL seconds in this server process (called
 * from instrumentation.ts). Set ASSISTDESK_EMAIL_POLLING=false to turn it off.
 */
export function startEmailPolling() {
  if (globalThis.assistdeskEmailPoller || process.env.ASSISTDESK_EMAIL_POLLING === "false") {
    return;
  }

  let running = false;
  const tick = async () => {
    if (running) {
      return;
    }

    running = true;

    try {
      await checkAllMailboxes();
    } catch (error) {
      console.error("[email] Mailbox polling failed:", error);
    } finally {
      running = false;
    }
  };

  globalThis.assistdeskEmailPoller = setInterval(() => void tick(), POLL_SECONDS * 1000);
  setTimeout(() => void tick(), 5_000);
  console.info(`[email] Checking connected mailboxes every ${POLL_SECONDS} seconds.`);
}
