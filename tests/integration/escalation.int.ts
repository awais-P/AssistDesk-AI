import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Module 9 - Support Escalation, against a real database: the trigger check on a
 * customer message, the escalation lifecycle (queue -> accepted -> resolved), the
 * one-open-escalation rule, the customer kept with the team, email tickets and the
 * hand-over summary. The AI model is replaced so the summary is deterministic.
 */

process.env.ASSISTDESK_ESCALATION_SUMMARY = "off";

const llm = { reply: null as string | null };

vi.mock("@/src/lib/llm-runtime", async (original) => ({
  ...(await original<typeof import("@/src/lib/llm-runtime")>()),
  generateCompletion: async () => llm.reply,
}));

const escalation = await import("@/src/lib/escalation");
const { closeSession } = await import("@/src/lib/session-lifecycle");
const { processIncomingTicket, processTicketFollowUp } = await import("@/src/lib/ticket-workflow");
const { generateEscalationSummary } = await import("@/src/lib/escalation-summary");

const suffix = Date.now().toString(36);
let workspaceId = "";
let sana = { id: "", fullName: "Sana Malik" };
let bilal = { id: "", fullName: "Bilal Ahmed" };
let contactId = "";
let ticketCounter = 0;

async function newSession(customerName = "Ali Raza", withContact = true) {
  return (
    await prisma.chatSession.create({
      data: { workspaceId, channel: "WEB_WIDGET", customerName, contactId: withContact ? contactId : null },
    })
  ).id;
}

/** The customer writes; the trigger check runs as it does before an AI reply. */
async function customerSays(sessionId: string, text: string) {
  await prisma.chatMessage.create({ data: { sessionId, sender: "USER", content: text } });
  return escalation.checkInboundEscalation({ workspaceId, sessionId, text });
}

const sessionOf = (id: string) => prisma.chatSession.findUniqueOrThrow({ where: { id } });
const escalationsOf = (sessionId: string) => prisma.escalation.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });

async function newTicket(subject: string, body: string) {
  ticketCounter += 1;
  const ticket = await prisma.ticket.create({
    data: { workspaceId, ticketNumber: ticketCounter, subject, previewText: body.slice(0, 120), requesterName: "Ali Raza", requesterEmail: `ali.${suffix}@example.com`, source: "EMAIL", contactId },
  });
  await prisma.ticketMessage.create({ data: { workspaceId, ticketId: ticket.id, sender: "USER", content: body } });
  return ticket.id;
}

beforeAll(async () => {
  workspaceId = (await prisma.workspace.create({ data: { name: `Escalation ${suffix}`, slug: `escalation-${suffix}` } })).id;
  sana = { id: (await prisma.user.create({ data: { workspaceId, fullName: sana.fullName, username: `sana-${suffix}`, email: `sana-${suffix}@example.com`, role: "AGENT" } })).id, fullName: sana.fullName };
  bilal = { id: (await prisma.user.create({ data: { workspaceId, fullName: bilal.fullName, username: `bilal-${suffix}`, email: `bilal-${suffix}@example.com`, role: "MANAGER" } })).id, fullName: bilal.fullName };
  contactId = (await prisma.contact.create({ data: { workspaceId, name: "Ali Raza", email: `ali.${suffix}@example.com` } })).id;
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.$disconnect();
});

describe("IT-19 escalation of a live conversation - Module 9 FE-1, FE-3, FE-6", () => {
  it("IT-19.01 a request for a person opens an escalation in the queue and pauses the AI", async () => {
    const sessionId = await newSession();
    const result = await customerSays(sessionId, "This is useless, I want to talk to a human");

    expect(result.escalated).toBe(true);
    expect((await sessionOf(sessionId)).status).toBe("ESCALATED");
    const [open] = await escalationsOf(sessionId);
    expect(open).toMatchObject({ trigger: "HUMAN_REQUEST", status: "PENDING", contactId, channel: "WEB_WIDGET" });
    expect(open.slaDueAt!.getTime() - open.createdAt.getTime()).toBe(15 * 60_000);
    expect(await prisma.sessionEvent.count({ where: { sessionId, type: "HUMAN_TAKEOVER" } })).toBe(1);
    const notice = await prisma.chatMessage.findFirstOrThrow({ where: { sessionId, sender: "SYSTEM" } });
    expect(notice.content).toMatch(/member of our team/);
    expect(await prisma.notification.count({ where: { workspaceId, type: "ESCALATION_CREATED" } })).toBeGreaterThan(0);
  });

  it("IT-19.02 every customer message gets a stored sentiment, and a calm one is not escalated", async () => {
    const sessionId = await newSession();
    const result = await customerSays(sessionId, "Thank you, what time do you open on Saturday?");

    expect(result.escalated).toBe(false);
    expect((await sessionOf(sessionId)).status).toBe("ACTIVE");
    const message = await prisma.chatMessage.findFirstOrThrow({ where: { sessionId, sender: "USER" } });
    expect(message.sentiment).toBeGreaterThan(0);
  });

  it("IT-19.03 frustration building over three messages is escalated", async () => {
    const sessionId = await newSession();
    expect((await customerSays(sessionId, "my order is late")).escalated).toBe(false);
    expect((await customerSays(sessionId, "still not here, this is annoying")).escalated).toBe(false);
    expect((await customerSays(sessionId, "still waiting, not happy at all")).escalated).toBe(true);
    expect((await escalationsOf(sessionId))[0]).toMatchObject({ trigger: "SENTIMENT" });
  });

  it("IT-19.04 a conversation has one open escalation; a more serious trigger raises its priority", async () => {
    const sessionId = await newSession();
    await escalation.openEscalation({ workspaceId, sessionId, trigger: "AI_TOOL", reason: "Needs a refund" });
    const again = await escalation.openEscalation({ workspaceId, sessionId, trigger: "KEYWORD", reason: "Mentioned a lawyer", priority: "HIGH" });

    expect(again.created).toBe(false);
    const all = await escalationsOf(sessionId);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ trigger: "AI_TOOL", priority: "HIGH" });
  });

  it("IT-19.05 two triggers arriving together still open only one escalation", async () => {
    const sessionId = await newSession();
    await Promise.all([
      escalation.openEscalation({ workspaceId, sessionId, trigger: "SENTIMENT", reason: "Upset" }),
      escalation.openEscalation({ workspaceId, sessionId, trigger: "HUMAN_REQUEST", reason: "Asked for a person" }),
    ]);
    expect(await escalationsOf(sessionId)).toHaveLength(1);
  });

  it("IT-19.06 a team member accepts from the queue; a colleague cannot take it without taking over", async () => {
    const sessionId = await newSession();
    const { escalation: open } = await escalation.openEscalation({ workspaceId, sessionId, trigger: "HUMAN_REQUEST", reason: "Asked for a person" });

    const accepted = await escalation.acceptEscalation({ workspaceId, escalationId: open.id, actor: sana });
    expect(accepted).toMatchObject({ status: "ACCEPTED", assigneeId: sana.id });
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    expect((await prisma.chatMessage.findMany({ where: { sessionId, sender: "SYSTEM" } })).map((message) => message.content)).toContain("Sana Malik joined the conversation.");

    await expect(escalation.acceptEscalation({ workspaceId, escalationId: open.id, actor: bilal })).rejects.toMatchObject({ status: 409 });
    expect(await escalation.acceptEscalation({ workspaceId, escalationId: open.id, actor: bilal, force: true })).toMatchObject({ assigneeId: bilal.id });
  });

  it("IT-19.07 a manager assigns an escalation to a team member of the same workspace only", async () => {
    const sessionId = await newSession();
    const { escalation: open } = await escalation.openEscalation({ workspaceId, sessionId, trigger: "SENTIMENT", reason: "Upset" });

    expect(await escalation.assignEscalation({ workspaceId, escalationId: open.id, assigneeId: sana.id, actor: bilal })).toMatchObject({ status: "ACCEPTED", assigneeId: sana.id });
    await expect(escalation.assignEscalation({ workspaceId, escalationId: open.id, assigneeId: "someone-else", actor: bilal })).rejects.toMatchObject({ status: 400 });
  });

  it("IT-19.08 handing back to the AI resolves the escalation and the AI answers again", async () => {
    const sessionId = await newSession();
    const { escalation: open } = await escalation.openEscalation({ workspaceId, sessionId, trigger: "HUMAN_REQUEST", reason: "Asked for a person" });
    const resolved = await escalation.resolveEscalation({ workspaceId, escalationId: open.id, actor: sana, outcome: "HANDED_BACK", note: "Refund issued" });

    expect(resolved).toMatchObject({ status: "RESOLVED", resolution: "HANDED_BACK", resolvedById: sana.id, resolutionNote: "Refund issued" });
    expect((await sessionOf(sessionId)).status).toBe("ACTIVE");
    expect(await prisma.sessionEvent.count({ where: { sessionId, type: "AI_RESUMED" } })).toBe(1);
    await expect(escalation.resolveEscalation({ workspaceId, escalationId: open.id, actor: sana, outcome: "CLOSED" })).rejects.toMatchObject({ status: 409 });
  });

  it("IT-19.09 closing the conversation resolves its open escalation", async () => {
    const sessionId = await newSession();
    await escalation.openEscalation({ workspaceId, sessionId, trigger: "SENTIMENT", reason: "Upset" });
    await closeSession(sessionId, "IDLE_TIMEOUT");

    expect((await escalationsOf(sessionId))[0]).toMatchObject({ status: "RESOLVED", resolution: "CLOSED" });
  });

  it("IT-19.10 a customer kept with the team goes straight to a person next time, until handed back", async () => {
    const first = await newSession();
    const { escalation: open } = await escalation.openEscalation({ workspaceId, sessionId: first, trigger: "KEYWORD", reason: "Legal" });
    await escalation.resolveEscalation({ workspaceId, escalationId: open.id, actor: sana, outcome: "RESOLVED", keepWithTeam: true });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).aiPaused).toBe(true);

    const second = await newSession();
    const result = await customerSays(second, "hi, quick question about my order");
    expect(result.escalated).toBe(true);
    const [flagged] = await escalationsOf(second);
    expect(flagged.trigger).toBe("CUSTOMER_FLAGGED");

    await escalation.resolveEscalation({ workspaceId, escalationId: flagged.id, actor: sana, outcome: "HANDED_BACK" });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).aiPaused).toBe(false);
    await expect(escalation.resolveEscalation({ workspaceId, escalationId: flagged.id, actor: sana, outcome: "HANDED_BACK", keepWithTeam: true })).rejects.toMatchObject({ status: 400 });
  });

  it("IT-19.11 switching escalation off in the settings stops the automatic triggers", async () => {
    await prisma.workspaceSetting.upsert({ where: { workspaceId }, create: { workspaceId, escalationEnabled: false }, update: { escalationEnabled: false } });
    const sessionId = await newSession("Hina", false);
    expect((await customerSays(sessionId, "I want to speak to a manager, worst service ever!!")).escalated).toBe(false);
    expect((await sessionOf(sessionId)).status).toBe("ACTIVE");
    await prisma.workspaceSetting.update({ where: { workspaceId }, data: { escalationEnabled: true } });
  });

  it("IT-19.12 an escalation nobody accepts in time is flagged once and the team is alerted", async () => {
    const sessionId = await newSession("Kamran", false);
    const { escalation: open } = await escalation.openEscalation({ workspaceId, sessionId, trigger: "HUMAN_REQUEST", reason: "Asked for a person" });
    const accepted = await escalation.openEscalation({ workspaceId, sessionId: await newSession("Zara", false), trigger: "SENTIMENT", reason: "Upset" });
    await escalation.acceptEscalation({ workspaceId, escalationId: accepted.escalation.id, actor: sana });

    const later = new Date(open.slaDueAt!.getTime() + 60_000);
    await escalation.checkEscalationSla(later);
    await escalation.checkEscalationSla(later);

    expect((await prisma.escalation.findUniqueOrThrow({ where: { id: open.id } })).slaBreachedAt).toEqual(later);
    expect((await prisma.escalation.findUniqueOrThrow({ where: { id: accepted.escalation.id } })).slaBreachedAt).toBeNull();
    expect(await prisma.notification.count({ where: { workspaceId, type: "ESCALATION_SLA_BREACHED", link: { contains: open.id } } })).toBe(1);
  });
});

describe("IT-20 escalation of email tickets and the hand-over summary - Module 9 FE-1, FE-2, FE-5", () => {
  it("IT-20.01 an angry email is escalated with a higher priority, an internal note and no AI reply", async () => {
    const ticketId = await newTicket("Charged twice!!", "You charged twice on my card. This is unacceptable, I want my money back now.");
    await processIncomingTicket(ticketId);

    const [open] = await prisma.escalation.findMany({ where: { ticketId } });
    expect(open).toMatchObject({ status: "PENDING", channel: "EMAIL", trigger: "KEYWORD" });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).priority).toBe("HIGH");
    const notes = await prisma.ticketMessage.findMany({ where: { ticketId, sender: "SYSTEM" } });
    expect(notes.some((note) => note.content.includes("Escalated to the team"))).toBe(true);
    expect(await prisma.ticketMessage.count({ where: { ticketId, sender: "AI" } })).toBe(0);
  });

  it("IT-20.02 an ordinary email is not escalated", async () => {
    const ticketId = await newTicket("Opening hours", "Hi, are you open on Sunday? Thanks");
    await processIncomingTicket(ticketId);
    expect(await prisma.escalation.count({ where: { ticketId } })).toBe(0);
  });

  it("IT-20.03 while a ticket is escalated the AI does not answer the customer's follow-up", async () => {
    const ticketId = await newTicket("Order 1042", "Where is my order?");
    await escalation.openEscalation({ workspaceId, ticketId, trigger: "AI_TOOL", reason: "Needs the warehouse" });
    await prisma.ticketMessage.create({ data: { workspaceId, ticketId, sender: "USER", content: "Any update?" } });

    expect(await processTicketFollowUp(ticketId)).toEqual({ processed: false, reason: "Escalated to the team." });
  });

  it("IT-20.04 the AI writes the hand-over brief for the team", async () => {
    const sessionId = await newSession("Ayesha", false);
    await prisma.chatMessage.create({ data: { sessionId, sender: "USER", content: "My kettle arrived broken, order 1042" } });
    const { escalation: open } = await escalation.openEscalation({ workspaceId, sessionId, trigger: "SENTIMENT", reason: "Upset" });

    llm.reply = "<brief>Issue: kettle from order 1042 arrived broken.\nTried so far: nothing.\nMood: frustrated.\nCustomer history: none.\nNext step: offer a replacement.</brief>";
    await generateEscalationSummary(open.id);
    const saved = await prisma.escalation.findUniqueOrThrow({ where: { id: open.id } });
    expect(saved.summary).toContain("order 1042 arrived broken");
    expect(saved.summaryGeneratedAt).toBeInstanceOf(Date);
  });

  it("IT-20.05 without a reachable model the brief is built from the messages", async () => {
    const sessionId = await newSession("Usman", false);
    await prisma.chatMessage.create({ data: { sessionId, sender: "USER", content: "Where is my refund for order 2210?" } });
    await prisma.chatMessage.create({ data: { sessionId, sender: "AI", content: "Refunds take 5 to 7 working days." } });
    const { escalation: open } = await escalation.openEscalation({ workspaceId, sessionId, trigger: "HUMAN_REQUEST", reason: "Asked for a person", sentimentScore: -0.6 });

    llm.reply = null;
    const summary = await generateEscalationSummary(open.id);
    expect(summary).toContain("Issue: Where is my refund for order 2210?");
    expect(summary).toContain("Mood: frustrated");
    expect(summary).toContain("Refunds take 5 to 7 working days.");
  });
});
