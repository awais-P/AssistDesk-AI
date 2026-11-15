import type { IntegrationConfigRecord } from "./integrations/config";

/**
 * Email providers whose mailbox AssistDesk reads itself over IMAP and sends replies from
 * over SMTP, with the same address and app password (see email-mailbox.ts).
 */
export const MAILBOX_PROVIDERS: Record<string, { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }> = {
  Gmail: { imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 465 },
};

export type MailboxSettings = {
  user: string;
  password: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
};

export function isMailboxProvider(provider: string | null | undefined) {
  return Boolean(provider && MAILBOX_PROVIDERS[provider]);
}

/** The mailbox login of an Email integration, or null when it is not a mailbox connection. */
export function mailboxSettings(provider: string | null | undefined, config: IntegrationConfigRecord): MailboxSettings | null {
  const servers = provider ? MAILBOX_PROVIDERS[provider] : undefined;
  const user = config.mailboxUser?.trim().toLowerCase();
  // App passwords are shown in groups of four ("abcd efgh ijkl mnop"); the spaces are not part of it.
  const password = config.mailboxPassword?.replace(/\s+/g, "");

  if (!servers || !user || !password) {
    return null;
  }

  return { user, password, ...servers };
}
