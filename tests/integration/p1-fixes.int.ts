import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Priority-1 fixes from REMAINING_WORK.md (16 Nov 2026): webhook secrets only for admins,
 * the block list, auto-assign only when switched on, the inbox auto-reply, the follow-up
 * and close-ticket automations, Playground limits, the offline new-chat email and the
 * background-job lease. Emails are captured instead of sent.
 */

type SessionUser = { id: string; role: string; workspaceId: string; fullName: string; email: string; customRole: null };
const signedIn: { current: { user: SessionUser } | null } = { current: null };
const sentReplies: Array<{ ticketId: string; content: string }> = [];

vi.mock("@/src/lib/auth", async (original) => ({
  ...(await original<typeof import("@/src/lib/auth")>()),
  getCurrentSession: async () => signedIn.current,
}));

vi.mock("@/src/lib/mailer", async (original) => ({
  ...(await original<typeof import("@/src/lib/mailer")>()),
  sendTicketReplyEmail: async ({ ticketId, content }: { ticketId: string; content: string }) => {
    sentReplies.push({ ticketId, content });
    return { status: "SENT", error: null };
  },
}));

const integrations = await import("@/app/api/integrations/route");
const inboxes = await import("@/app/api/inboxes/route");
const playground = await import("@/app/api/ai-agents/[id]/playground/route");
const { processIncomingTicket } = await import("@/src/lib/ticket-workflow");
const { runTicketInactivityAutomations, FOLLOW_UP_AUTHOR } = await import("@/src/lib/ticket-inactivity");
const { notifyNewChatWhileOffline } = await import("@/src/lib/chat-alerts");
const { runBackgroundJobsOnce } = await import("@/src/lib/background-jobs");
const { ensureAgentAutomationDefaults } = await import("@/src/lib/agent-automations");
const { openEscalation } = await import("@/src/lib/escalation");
const { RATE_LIMITS, consumeRateLimit, resetRateLimit } = await import("@/src/lib/rate-limit");

const suffix = Date.now().toString(36);
const HOUR = 60 * 60 * 1000;
let workspaceId = "";
let inboxId = "";
let agentId = "";
let cannedId = "";
const ids = { admin: "", agent: "" };
let nextNumber = 920001;

async function signIn(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  signedIn.current = { user: { id: user.id, role: user.role, workspaceId: user.workspaceId, fullName: user.fullName, email: user.email, customRole: null } };
}

const json = (body: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function setAutomation(key: string, isEnabled: boolean, summary?: string) {
  await prisma.agentAutomation.updateMany({ where: { agentId, key }, data: { isEnabled, ...(summary !== undefined ? { summary } : {}) } });
}

async function emailTicket(subject: string, body: string, requesterEmail = `customer.${suffix}@example.com`) {
  const ticket = await prisma.ticket.create({
    data: { workspaceId, inboxId, ticketNumber: nextNumber++, subject, previewText: body.slice(0, 120), requesterName: "Sara Khan", requesterEmail, source: "EMAIL", status: "OPEN" },
  });
  await prisma.ticketMessage.create({ data: { workspaceId, ticketId: ticket.id, sender: "USER", content: body } });
  return ticket.id;
}

/** A ticket we answered `hoursAgo` hours ago and the customer never replied to. */
async function answeredTicket(hoursAgo: number, now: Date) {
  const ticketId = await emailTicket(`Question ${nextNumber}`, "How do I change my plan?");
  const at = new Date(now.getTime() - hoursAgo * HOUR);
  await prisma.ticketMessage.updateMany({ where: { ticketId }, data: { createdAt: new Date(at.getTime() - 60_000) } });
  await prisma.ticketMessage.create({ data: { workspaceId, ticketId, sender: "AGENT", authorName: "Ayesha", content: "Go to Settings → Billing and choose a plan.", createdAt: at } });
  await prisma.ticket.update({ where: { id: ticketId }, data: { status: "IN_PROGRESS" } });
  await prisma.$executeRaw`UPDATE "Ticket" SET "updatedAt" = ${at} WHERE id = ${ticketId}`;
  return ticketId;
}

beforeAll(async () => {
  workspaceId = (await prisma.workspace.create({ data: { name: `P1 fixes ${suffix}`, slug: `p1-fixes-${suffix}` } })).id;
  for (const role of ["admin", "agent"] as const) {
    ids[role] = (
      await prisma.user.create({
        data: { workspaceId, fullName: `${role} ${suffix}`, username: `${role}-p1-${suffix}`, email: `${role}-p1-${suffix}@example.com`, role: role.toUpperCase() as "ADMIN" | "AGENT" },
      })
    ).id;
  }
  inboxId = (await prisma.inbox.create({ data: { workspaceId, name: "Support", emailPrefix: `p1-${suffix}`, ticketPrefix: "P1" } })).id;
  agentId = (await prisma.aIAgent.create({ data: { workspaceId, inboxId, name: "Desk agent", provider: "Default", model: "groq/llama-3.3-70b-versatile", status: "ACTIVE" } })).id;
  await ensureAgentAutomationDefaults(workspaceId, agentId);
  // The AI reply itself is covered elsewhere (IT-12); here it would only slow the run.
  await setAutomation("ai-response", false);
  await prisma.integration.create({ data: { workspaceId, inboxId, type: "EMAIL", name: "Support email", provider: "Webhook", webhookSecret: `p1-secret-${suffix}`, status: "CONNECTED" } });
  cannedId = (await prisma.cannedResponse.create({ data: { workspaceId, title: "We got it", body: "Hi {{customer_name}}, we received {{ticket_number}} about \"{{subject}}\"." } })).id;
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.$disconnect();
});

describe("IT-28 priority-1 fixes - SEC-19, BUG-03, BUG-05, FR-15.5, UI-44, SEC-39, FR-13.8, OPS-13", () => {
  it("IT-28.01 only admins receive the email webhook secret - SEC-19", async () => {
    await signIn(ids.agent);
    const asAgent = (await (await integrations.GET()).json()).integrations[0];
    expect(asAgent.webhookSecret).toBeNull();
    expect(asAgent.hasWebhookSecret).toBe(true);

    await signIn(ids.admin);
    const asAdmin = (await (await integrations.GET()).json()).integrations[0];
    expect(asAdmin.webhookSecret).toBe(`p1-secret-${suffix}`);
  });

  it("IT-28.02 the block list closes tickets by domain or keyword, with no escalation or reply - BUG-03", async () => {
    await setAutomation("block-list", true, "promo.example.net\nunsubscribe");
    await setAutomation("ai-response", true);
    await prisma.inbox.update({ where: { id: inboxId }, data: { autoReplyEnabled: true, autoReplyTemplateId: cannedId } });

    const byDomain = await emailTicket("I want a manager NOW, this is terrible", "Refund me immediately or I will sue.", `deals@mail.promo.example.net`);
    await processIncomingTicket(byDomain);
    const byKeyword = await emailTicket("Weekly digest", "Click here to unsubscribe from these emails.");
    await processIncomingTicket(byKeyword);

    for (const ticketId of [byDomain, byKeyword]) {
      const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { messages: true } });
      expect(ticket.status).toBe("CLOSED");
      expect(ticket.assigneeId).toBeNull();
      expect(ticket.messages.filter((message) => message.sender !== "USER")).toHaveLength(0);
      expect(await prisma.escalation.count({ where: { ticketId } })).toBe(0);
      expect(await prisma.automationLog.count({ where: { ticketId, action: "AI_RESPONSE" } })).toBe(0);
    }
    const log = await prisma.automationLog.findFirstOrThrow({ where: { ticketId: byDomain, action: "BLOCK_LIST" } });
    expect(log.summary).toContain("promo.example.net");

    // A look-alike domain and an ordinary email are not blocked.
    const allowed = await emailTicket("Order question", "Where is my parcel?", `ali@notpromo.example.org`);
    await setAutomation("ai-response", false);
    await processIncomingTicket(allowed);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: allowed } })).status).not.toBe("CLOSED");
    await setAutomation("block-list", false);
    await prisma.inbox.update({ where: { id: inboxId }, data: { autoReplyEnabled: false, autoReplyTemplateId: null } });
  });

  it("IT-28.03 tickets are assigned only when the Assign To automation is on - BUG-05", async () => {
    const off = await emailTicket("Login help", "I can't sign in.");
    await processIncomingTicket(off);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: off } })).assigneeId).toBeNull();

    await setAutomation("assign-to", true, `agent-p1-${suffix}@example.com`);
    const on = await emailTicket("Login help again", "Still can't sign in.");
    await processIncomingTicket(on);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: on } })).assigneeId).toBe(ids.agent);
    await setAutomation("assign-to", false);
  });

  it("IT-28.04 the inbox auto-reply needs a template from this workspace and fills its variables - FR-15.5", async () => {
    await signIn(ids.admin);
    const base = { id: inboxId, name: "Support", emailPrefix: `p1-${suffix}`, ticketPrefix: "P1" };
    expect((await inboxes.POST(json({ ...base, autoReplyEnabled: true }))).status).toBe(400);
    const foreign = await prisma.cannedResponse.create({
      data: { workspace: { create: { name: `Other ${suffix}`, slug: `other-p1-${suffix}` } }, title: "Theirs", body: "x" },
      select: { id: true, workspaceId: true },
    });
    expect((await inboxes.POST(json({ ...base, autoReplyEnabled: true, autoReplyTemplateId: foreign.id }))).status).toBe(400);
    await prisma.workspace.delete({ where: { id: foreign.workspaceId } });
    expect((await inboxes.POST(json({ ...base, autoReplyEnabled: true, autoReplyTemplateId: cannedId }))).status).toBe(200);

    sentReplies.length = 0;
    const ticketId = await emailTicket("Invoice copy", "Please send my last invoice.");
    await processIncomingTicket(ticketId);
    const reply = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId, authorName: "Auto-reply" } });
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(reply.content).toBe(`Hi Sara Khan, we received #${ticket.ticketNumber} about "Invoice copy".`);
    expect(sentReplies).toEqual([{ ticketId, content: reply.content }]);
    expect((await prisma.automationLog.findFirstOrThrow({ where: { ticketId, action: "AUTO_REPLY" } })).status).toBe("SUCCESS");

    // Dashboard-created tickets are not "received", so they get no auto-reply.
    const manual = await prisma.ticket.create({ data: { workspaceId, inboxId, ticketNumber: nextNumber++, subject: "Call back", requesterEmail: "x@example.com", source: "MANUAL" } });
    await processIncomingTicket(manual.id);
    expect(await prisma.ticketMessage.count({ where: { ticketId: manual.id, authorName: "Auto-reply" } })).toBe(0);
    await prisma.inbox.update({ where: { id: inboxId }, data: { autoReplyEnabled: false } });
  });

  it("IT-28.05 a quiet customer gets one follow-up, then the ticket is closed - UI-44, BUG-06", async () => {
    await setAutomation("ai-follow-up", true, "After 24h of inactivity");
    await setAutomation("close-ticket", true, "after 2 days");
    const now = new Date();
    const quiet = await answeredTicket(30, now);
    const old = await answeredTicket(50, now);
    const fresh = await answeredTicket(2, now);
    const waitingForUs = await emailTicket("Still broken", "It still doesn't work.");
    const escalated = await answeredTicket(30, now);
    await openEscalation({ workspaceId, ticketId: escalated, trigger: "MANUAL", reason: "VIP customer", customerNotice: null });

    sentReplies.length = 0;
    const first = await runTicketInactivityAutomations({ now, workspaceId });
    expect(first.followUps).toBe(1);
    expect(first.closed).toBe(1);
    const followUp = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: quiet, authorName: FOLLOW_UP_AUTHOR } });
    expect(followUp.content).toContain(`#`);
    expect(sentReplies.map((reply) => reply.ticketId)).toEqual([quiet]);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: old } })).status).toBe("CLOSED");
    for (const untouched of [fresh, waitingForUs, escalated]) {
      expect(await prisma.ticketMessage.count({ where: { ticketId: untouched, authorName: FOLLOW_UP_AUTHOR } })).toBe(0);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: untouched } })).status).not.toBe("CLOSED");
    }

    // Run again: no second follow-up; the close still counts from our real reply (30h + 20h).
    expect((await runTicketInactivityAutomations({ now, workspaceId })).followUps).toBe(0);
    const later = await runTicketInactivityAutomations({ now: new Date(now.getTime() + 20 * HOUR), workspaceId });
    expect(later.followUps).toBe(0);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: quiet } })).status).toBe("CLOSED");
    expect(await prisma.automationLog.count({ where: { ticketId: quiet, action: "CLOSE_TICKET" } })).toBe(1);
    await setAutomation("ai-follow-up", false);
    await setAutomation("close-ticket", false);
  });

  it("IT-28.06 the Playground is rate-limited and respects the plan's AI replies - SEC-39", async () => {
    await signIn(ids.agent);
    const params = { params: Promise.resolve({ id: agentId }) };
    await resetRateLimit(`ai-test:${ids.agent}`);
    for (let index = 0; index < RATE_LIMITS.aiTestPerUser.limit; index += 1) {
      await consumeRateLimit(`ai-test:${ids.agent}`, RATE_LIMITS.aiTestPerUser);
    }
    const limited = await playground.POST(json({ message: "hello" }), params);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();

    await resetRateLimit(`ai-test:${ids.agent}`);
    await prisma.subscription.create({ data: { workspaceId, plan: "FREE", status: "ACTIVE", provider: "TEST" } });
    for (let index = 0; index < 100; index += 1) {
      await prisma.aiInteraction.create({ data: { workspaceId, agentId, channel: "WEB_WIDGET", question: "q", latencyMs: 1 } });
    }
    const overPlan = await playground.POST(json({ message: "hello" }), params);
    expect(overPlan.status).toBe(402);
    expect((await overPlan.json()).code).toBe("plan_limit");
    await prisma.subscription.delete({ where: { workspaceId } });
  });

  it("IT-28.07 a new chat while nobody is online emails the team; not when someone is online or it's off - FR-13.8", async () => {
    const sent: Array<{ to: string[]; subject: string; text: string }> = [];
    const send = async (message: { to: string[]; subject: string; text: string }) => {
      sent.push(message);
      return { status: "SENT" as const, error: null };
    };
    const chatbot = { id: "bot", name: "Website bot", workspaceId, emailNotifications: true };
    const chat = { customerName: "Bilal", customerEmail: null, firstMessage: "Do you ship to Lahore?" };

    await prisma.user.updateMany({ where: { workspaceId }, data: { lastSeenAt: null } });
    expect((await notifyNewChatWhileOffline(chatbot, chat, send)).sent).toBe(true);
    expect(sent[0].to.sort()).toEqual([`admin-p1-${suffix}@example.com`, `agent-p1-${suffix}@example.com`]);
    expect(sent[0].text).toContain("Do you ship to Lahore?");

    expect((await notifyNewChatWhileOffline({ ...chatbot, emailNotifications: false }, chat, send)).reason).toBe("switched off");
    await prisma.user.update({ where: { id: ids.agent }, data: { lastSeenAt: new Date() } });
    expect((await notifyNewChatWhileOffline(chatbot, chat, send)).reason).toBe("team online");
    expect(sent).toHaveLength(1);
  });

  it("IT-28.08 only one server runs a round of background jobs at a time - OPS-13", async () => {
    await resetRateLimit("jobs:background");
    const first = await runBackgroundJobsOnce();
    expect(first).not.toBeNull();
    expect(first).toHaveProperty("expiredSessions");
    expect(first).toHaveProperty("webhookDeliveries");
    expect(first).toHaveProperty("ticketFollowUps");
    expect(await runBackgroundJobsOnce()).toBeNull();
    await resetRateLimit("jobs:background");
  });
});
