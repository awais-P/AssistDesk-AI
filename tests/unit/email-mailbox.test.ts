import { describe, expect, it } from "vitest";
import { automatedEmailReason, mailboxCursor } from "@/src/lib/email-mailbox";
import { mailboxSettings } from "@/src/lib/email-mailbox-settings";
import { mergeIntegrationConfig, readIntegrationConfig } from "@/src/lib/integrations/config";

const mailbox = "acme.support@gmail.com";
const headers = (entries: Record<string, string> = {}) => new Map<string, unknown>(Object.entries(entries));

describe("UT-49 email by mailbox (Gmail) - FR-15", () => {
  it("UT-49.01 accepts an email written by a person", () => {
    expect(automatedEmailReason({ fromEmail: "ali.raza@gmail.com", mailbox, headers: headers() })).toBeNull();
  });

  it("UT-49.02 skips email sent by the support mailbox itself", () => {
    expect(automatedEmailReason({ fromEmail: mailbox, mailbox, headers: headers() })).toMatch(/support mailbox/);
  });

  it("UT-49.03 skips bounces and no-reply senders", () => {
    for (const fromEmail of ["mailer-daemon@googlemail.com", "no-reply@accounts.google.com", "noreply@shop.com", "postmaster@example.com"]) {
      expect(automatedEmailReason({ fromEmail, mailbox, headers: headers() }), fromEmail).not.toBeNull();
    }
  });

  it("UT-49.04 skips automatic replies such as out-of-office", () => {
    const automatic: Array<Record<string, string>> = [{ "auto-submitted": "auto-replied" }, { precedence: "auto_reply" }, { "x-autoreply": "yes" }];
    for (const entries of automatic) {
      expect(automatedEmailReason({ fromEmail: "ali.raza@gmail.com", mailbox, headers: headers(entries) })).not.toBeNull();
    }
    expect(automatedEmailReason({ fromEmail: "ali.raza@gmail.com", mailbox, headers: headers({ "auto-submitted": "no" }) })).toBeNull();
  });

  it("UT-49.05 skips newsletters and mailing lists", () => {
    expect(automatedEmailReason({ fromEmail: "news@brand.com", mailbox, headers: headers({ "list-unsubscribe": "<mailto:x@brand.com>" }) })).toMatch(/newsletter/);
  });

  it("UT-49.06 starts at the newest email when a mailbox is first connected", () => {
    expect(mailboxCursor({}, { mailbox, uidValidity: "7", uidNext: 120 })).toEqual({ lastUid: 119, reset: true });
  });

  it("UT-49.07 continues after the last email it read", () => {
    expect(mailboxCursor({ mailbox, uidValidity: "7", lastUid: "119" }, { mailbox, uidValidity: "7", uidNext: 125 })).toEqual({
      lastUid: 119,
      reset: false,
    });
  });

  it("UT-49.08 starts again at the newest email when the mailbox is replaced", () => {
    expect(mailboxCursor({ mailbox: "old@gmail.com", uidValidity: "7", lastUid: "40" }, { mailbox, uidValidity: "7", uidNext: 9 }).reset).toBe(true);
    expect(mailboxCursor({ mailbox, uidValidity: "7", lastUid: "40" }, { mailbox, uidValidity: "8", uidNext: 9 })).toEqual({ lastUid: 8, reset: true });
  });

  it("UT-49.09 reads the Gmail login and ignores the spaces Google shows in app passwords", () => {
    expect(mailboxSettings("Gmail", { mailboxUser: " Acme.Support@Gmail.com ", mailboxPassword: "abcd efgh ijkl mnop" })).toMatchObject({
      user: mailbox,
      password: "abcdefghijklmnop",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
    expect(mailboxSettings("Gmail", { mailboxUser: mailbox })).toBeNull();
    expect(mailboxSettings("Forwarded Inbox", { mailboxUser: mailbox, mailboxPassword: "x" })).toBeNull();
  });

  it("UT-49.10 stores the app password encrypted and keeps it when the field is left blank", () => {
    const saved = mergeIntegrationConfig("EMAIL", { mailboxUser: mailbox, mailboxPassword: "abcdefghijklmnop" }, null);
    expect(saved.mailboxPassword).not.toBe("abcdefghijklmnop");
    expect(readIntegrationConfig("EMAIL", saved as never).mailboxPassword).toBe("abcdefghijklmnop");

    const edited = mergeIntegrationConfig("EMAIL", { mailboxUser: mailbox, mailboxPassword: "" }, saved as never);
    expect(readIntegrationConfig("EMAIL", edited as never).mailboxPassword).toBe("abcdefghijklmnop");
  });
});
