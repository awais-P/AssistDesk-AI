import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/prisma";
import { processIncomingTicket } from "@/src/lib/ticket-workflow";

/**
 * UI-45: tickets created in the dashboard get their AI reply in the background. The
 * rule-based steps still run in the request, and a status an agent sets meanwhile wins.
 * No AI provider key is set in the test run, so the reply comes from the fallback path.
 */

const suffix = Date.now().toString(36);
let workspaceId = "";
let inboxId = "";
let nextNumber = 910001;

async function newTicket(subject: string) {
  const ticket = await prisma.ticket.create({
    data: { workspaceId, inboxId, ticketNumber: nextNumber++, subject, previewText: subject, requesterEmail: "customer@example.com", status: "OPEN" },
  });
  await prisma.ticketMessage.create({ data: { workspaceId, ticketId: ticket.id, sender: "USER", content: subject } });
  return ticket.id;
}

async function waitForAiResponse(ticketId: string) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const log = await prisma.automationLog.findFirst({ where: { ticketId, action: "AI_RESPONSE" } });

    if (log) {
      // The status update follows the log entry; give it a moment.
      await new Promise((resolve) => setTimeout(resolve, 300));
      return log;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("The deferred AI reply did not run.");
}

beforeAll(async () => {
  const workspace = await prisma.workspace.create({
    data: { name: `Ticket workflow ${suffix}`, slug: `ticket-workflow-${suffix}`, supportEmail: `support-${suffix}@example.com` },
  });
  workspaceId = workspace.id;
  inboxId = (await prisma.inbox.create({ data: { workspaceId, name: "Support", emailPrefix: `tw-${suffix}`, ticketPrefix: "TW" } })).id;
  await prisma.aIAgent.create({ data: { workspaceId, inboxId, name: "Ticket agent", provider: "Default", model: "groq/llama-3.3-70b-versatile", status: "ACTIVE" } });
});

afterAll(async () => {
  if (workspaceId) {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  }
  await prisma.$disconnect();
});

describe("IT-12 dashboard tickets: AI reply in the background - UI-45", () => {
  it("IT-12.01 returns before the AI reply, then replies and moves the ticket to In Progress", async () => {
    const ticketId = await newTicket("Kettle stopped heating after two weeks");
    const result = await processIncomingTicket(ticketId, { deferAiReply: true });

    expect(result.processed).toBe(true);
    // Nothing from the model yet when the request finishes.
    expect(await prisma.ticketMessage.count({ where: { ticketId, sender: { in: ["AI", "SYSTEM"] } } })).toBe(0);

    await waitForAiResponse(ticketId);
    expect(await prisma.ticketMessage.count({ where: { ticketId, sender: { in: ["AI", "SYSTEM"] } } })).toBe(1);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("IN_PROGRESS");
  });

  it("IT-12.02 keeps a status that an agent set while the reply was being written", async () => {
    const ticketId = await newTicket("Question about my invoice");
    await processIncomingTicket(ticketId, { deferAiReply: true });
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: "RESOLVED" } });

    // Whether the background job started before or after the change, it must not undo it.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("RESOLVED");
  });

  it("IT-12.03 still replies inside the request when not deferred - email tickets", async () => {
    const ticketId = await newTicket("Delivery delayed to Multan");
    await processIncomingTicket(ticketId);

    expect(await prisma.automationLog.count({ where: { ticketId, action: "AI_RESPONSE" } })).toBe(1);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("IN_PROGRESS");
  });
});
