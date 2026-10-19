import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Email by mailbox: new mail in a connected Gmail mailbox becomes tickets. The IMAP
 * server is replaced by an in-memory mailbox (Gmail cannot be reached from a test); the
 * database, the ingestion and the threading are real. The AI workflow is switched off.
 */

const server = {
  uidValidity: BigInt(7),
  failLogin: false,
  messages: [] as Array<{ uid: number; raw: string }>,
};

vi.mock("imapflow", () => ({
  ImapFlow: class {
    mailbox: { uidValidity: bigint; uidNext: number } | false = false;

    async connect() {
      if (server.failLogin) {
        throw Object.assign(new Error("Authentication failed."), { authenticationFailed: true });
      }
    }

    async getMailboxLock() {
      const last = server.messages.at(-1)?.uid ?? 0;
      this.mailbox = { uidValidity: server.uidValidity, uidNext: last + 1 };
      return { release() {} };
    }

    async *fetch(range: string) {
      const from = Number(range.split(":")[0]);
      for (const message of server.messages.filter((entry) => entry.uid >= from)) {
        yield { uid: message.uid, source: Buffer.from(message.raw) };
      }
    }

    async logout() {}
  },
}));

vi.mock("@/src/lib/ticket-workflow", async (original) => ({
  ...(await original<typeof import("@/src/lib/ticket-workflow")>()),
  processIncomingTicket: async () => undefined,
  processTicketFollowUp: async () => undefined,
}));

const { checkMailbox } = await import("@/src/lib/email-mailbox");
const { mergeIntegrationConfig } = await import("@/src/lib/integrations/config");

const suffix = Date.now().toString(36);
const mailbox = `support-${suffix}@gmail.com`;
const customer = `ali.raza.${suffix}@example.com`;
let workspaceId = "";
let integrationId = "";

function email(uid: number, { from = `Ali Raza <${customer}>`, subject = "Where is my order 1042?", body = "Hi, when will my kettle arrive?", extra = "" } = {}) {
  server.messages.push({
    uid,
    raw: [
      `From: ${from}`,
      `To: ${mailbox}`,
      `Subject: ${subject}`,
      `Message-ID: <it18-${uid}-${suffix}@example.com>`,
      "Date: Mon, 19 Oct 2026 10:00:00 +0000",
      ...(extra ? [extra] : []),
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
      "",
    ].join("\r\n"),
  });
}

async function check() {
  const integration = await prisma.integration.findUniqueOrThrow({
    where: { id: integrationId },
    select: { id: true, workspaceId: true, inboxId: true, name: true, provider: true, supportAddress: true, forwardingAddress: true, config: true },
  });
  return checkMailbox(integration);
}

const tickets = () => prisma.ticket.findMany({ where: { workspaceId }, include: { messages: true }, orderBy: { ticketNumber: "asc" } });

beforeAll(async () => {
  workspaceId = (await prisma.workspace.create({ data: { name: `Mailbox ${suffix}`, slug: `mailbox-${suffix}`, supportEmail: mailbox } })).id;
  const inbox = await prisma.inbox.create({ data: { workspaceId, name: "Support", emailPrefix: `mailbox-${suffix}`, ticketPrefix: "GM" } });
  integrationId = (
    await prisma.integration.create({
      data: {
        workspaceId,
        inboxId: inbox.id,
        type: "EMAIL",
        name: "Support Gmail",
        provider: "Gmail",
        status: "CONNECTED",
        supportAddress: mailbox,
        isActive: true,
        config: mergeIntegrationConfig("EMAIL", { mailboxUser: mailbox, mailboxPassword: "abcd efgh ijkl mnop" }, null) as object,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.$disconnect();
});

describe("IT-18 email by mailbox (Gmail) - FR-15", () => {
  it("IT-18.01 the first check only remembers the newest email, the existing inbox is not imported", async () => {
    email(5, { subject: "An old email already in the inbox" });
    expect(await check()).toEqual({ received: 0 });
    expect(await tickets()).toHaveLength(0);
  });

  it("IT-18.02 a new customer email becomes a ticket", async () => {
    email(6);
    expect(await check()).toEqual({ received: 1 });
    const [ticket] = await tickets();
    expect(ticket).toMatchObject({ subject: "Where is my order 1042?", requesterEmail: customer, requesterName: "Ali Raza" });
  });

  it("IT-18.03 checking again does not create the ticket twice", async () => {
    expect(await check()).toEqual({ received: 0 });
    expect(await tickets()).toHaveLength(1);
  });

  it("IT-18.04 the customer's reply joins the same ticket", async () => {
    const [ticket] = await tickets();
    email(7, { subject: `Re: Where is my order 1042? [GM-${ticket.ticketNumber}]`, body: "Thanks! Can you send the receipt?" });
    expect(await check()).toEqual({ received: 1 });
    const all = await tickets();
    expect(all).toHaveLength(1);
    expect(all[0].messages.map((message) => message.content).join(" ")).toContain("Can you send the receipt?");
  });

  it("IT-18.05 bounces and automatic replies do not create tickets", async () => {
    email(8, { from: `Mail Delivery Subsystem <mailer-daemon@googlemail.com>`, subject: "Delivery Status Notification (Failure)" });
    email(9, { subject: "Out of office", extra: "Auto-Submitted: auto-replied" });
    expect(await check()).toEqual({ received: 0 });
    expect(await tickets()).toHaveLength(1);
  });

  it("IT-18.06 a wrong app password stops the connection and tells the team", async () => {
    server.failLogin = true;
    expect(await check()).toEqual({ received: 0 });
    const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
    expect(integration.status).toBe("ERROR");
    expect(integration.statusMessage).toMatch(/App Password/);
    expect(await prisma.notification.count({ where: { workspaceId, type: "INTEGRATION_ERROR" } })).toBe(1);
  });
});
