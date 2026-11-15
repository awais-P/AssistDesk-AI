import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Business-rule tests (Chapter 5.3 and Appendix C of the final report). Each group tests one
 * business rule from the SRS with a decision table; each test is one rule (R1, R2, ...) of
 * that table, run against a real database and the real route handlers.
 */

const signedIn: { current: { user: { id: string; role: string; workspaceId: string } } | null } = { current: null };

// Only the session lookup is replaced; password hashing and validation stay real.
vi.mock("@/src/lib/auth", async (original) => ({
  ...(await original<typeof import("@/src/lib/auth")>()),
  getCurrentSession: async () => signedIn.current,
}));

const { decideWidgetReply, isFallbackReplyDue, getWidgetChatbot } = await import("@/src/lib/chatbot-widget");
const signup = await import("@/app/api/auth/signup/route");
const inboxes = await import("@/app/api/inboxes/route");
const { buildPrompt } = await import("@/src/lib/llm-runtime");

const suffix = Date.now().toString(36);
let workspaceId = "";
let otherWorkspaceId = "";
let agentId = "";
let teamMemberId = "";
const signupEmails: string[] = [];

beforeAll(async () => {
  workspaceId = (await prisma.workspace.create({ data: { name: `BR ${suffix}`, slug: `br-${suffix}`, supportEmail: `br-${suffix}@example.com` } })).id;
  otherWorkspaceId = (await prisma.workspace.create({ data: { name: `BR other ${suffix}`, slug: `br-other-${suffix}`, supportEmail: `br-other-${suffix}@example.com` } })).id;
  agentId = (await prisma.aIAgent.create({ data: { workspaceId, name: "Support agent", provider: "Default", model: "groq/llama-3.3-70b-versatile", status: "ACTIVE" } })).id;
  teamMemberId = (await prisma.user.create({ data: { workspaceId, fullName: "Sana Malik", username: `sana-${suffix}`, email: `sana-${suffix}@example.com`, role: "AGENT" } })).id;
  await prisma.inbox.create({ data: { workspaceId: otherWorkspaceId, name: "Sales", emailPrefix: `taken-${suffix}`, ticketPrefix: "SL" } });
});

afterAll(async () => {
  const created = await prisma.user.findMany({ where: { email: { in: signupEmails } }, select: { workspaceId: true } });
  const ids = [workspaceId, otherWorkspaceId, ...created.map((user) => user.workspaceId)].filter(Boolean);
  await prisma.workspace.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------------------------
// BR-1: when the AI answers a visitor in the website widget.
// ---------------------------------------------------------------------------------------------

type ChatbotSettings = { aiRepliesEnabled?: boolean; replyMode?: "ALWAYS" | "OPERATOR_OFFLINE" | "FALLBACK"; maxAiMessages?: number; fallbackDelaySeconds?: number };

async function chatWith(settings: ChatbotSettings, messages: Array<{ sender: "USER" | "AI" | "AGENT"; secondsAgo: number }> = [], status = "ACTIVE") {
  const widgetId = `br-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
  await prisma.chatbot.create({ data: { workspaceId, agentId, name: "Store chat", widgetId, allowedDomains: ["example.com"], ...settings } });
  const chatbot = (await getWidgetChatbot(widgetId))!;
  const session = await prisma.chatSession.create({ data: { workspaceId, chatbotId: chatbot.id, channel: "WEB_WIDGET", status: status as "ACTIVE" } });
  for (const message of messages) {
    await prisma.chatMessage.create({ data: { sessionId: session.id, sender: message.sender, content: "Hello", createdAt: new Date(Date.now() - message.secondsAgo * 1000) } });
  }
  return { chatbot, sessionId: session.id, sessionStatus: status };
}

async function setTeamOnline(online: boolean) {
  await prisma.user.update({ where: { id: teamMemberId }, data: { lastSeenAt: online ? new Date() : null } });
}

describe("IT-14 BR-1 when the AI answers in the widget - FR-14.2, FR-14.4, FR-14.5, FR-14.6, FR-14.8", () => {
  beforeEach(async () => {
    await setTeamOnline(false);
  });

  it("IT-14.01 R1 a chat taken over by a team member gets no AI reply", async () => {
    await setTeamOnline(true);
    const chat = await chatWith({ replyMode: "ALWAYS" }, [{ sender: "USER", secondsAgo: 5 }], "ESCALATED");
    expect(await decideWidgetReply(chat)).toEqual({ action: "WAIT_FOR_HUMAN", notice: null });
  });

  it("IT-14.02 R2 with AI responses switched off the visitor is told a person will reply", async () => {
    const chat = await chatWith({ aiRepliesEnabled: false });
    const decision = await decideWidgetReply(chat);
    expect(decision.action).toBe("SYSTEM");
  });

  it("IT-14.03 R3 after the AI message limit the AI stops answering in that chat", async () => {
    const chat = await chatWith({ maxAiMessages: 2 }, [
      { sender: "USER", secondsAgo: 30 },
      { sender: "AI", secondsAgo: 29 },
      { sender: "USER", secondsAgo: 20 },
      { sender: "AI", secondsAgo: 19 },
    ]);
    const decision = await decideWidgetReply(chat);
    expect(decision.action).toBe("SYSTEM");
    expect(decision).toMatchObject({ content: expect.stringContaining("2") });
  });

  it("IT-14.04 R4 in Always mode the AI answers even when a team member is online", async () => {
    await setTeamOnline(true);
    const chat = await chatWith({ replyMode: "ALWAYS" });
    expect(await decideWidgetReply(chat)).toEqual({ action: "AI_NOW" });
  });

  it("IT-14.05 R5 in Operator offline mode the AI answers when nobody is online", async () => {
    const chat = await chatWith({ replyMode: "OPERATOR_OFFLINE" });
    expect(await decideWidgetReply(chat)).toEqual({ action: "AI_NOW" });
  });

  it("IT-14.06 R6 in Operator offline mode the AI waits when a team member is online", async () => {
    await setTeamOnline(true);
    const chat = await chatWith({ replyMode: "OPERATOR_OFFLINE" });
    const decision = await decideWidgetReply(chat);
    expect(decision.action).toBe("WAIT_FOR_HUMAN");
  });

  it("IT-14.07 R7 in Fallback mode the AI steps in when no person replied within the delay", async () => {
    await setTeamOnline(true);
    const chat = await chatWith({ replyMode: "FALLBACK", fallbackDelaySeconds: 30 }, [{ sender: "USER", secondsAgo: 45 }]);
    expect((await decideWidgetReply(chat)).action).toBe("WAIT_FOR_HUMAN");
    expect(await isFallbackReplyDue(chat.chatbot, chat.sessionId)).toBe(true);
  });

  it("IT-14.08 R8 in Fallback mode the AI keeps waiting before the delay has passed", async () => {
    await setTeamOnline(true);
    const chat = await chatWith({ replyMode: "FALLBACK", fallbackDelaySeconds: 60 }, [{ sender: "USER", secondsAgo: 10 }]);
    expect(await isFallbackReplyDue(chat.chatbot, chat.sessionId)).toBe(false);
  });

  it("IT-14.09 R9 in Fallback mode the AI stays silent when a team member already replied", async () => {
    await setTeamOnline(true);
    const chat = await chatWith({ replyMode: "FALLBACK", fallbackDelaySeconds: 30 }, [
      { sender: "USER", secondsAgo: 60 },
      { sender: "AGENT", secondsAgo: 50 },
    ]);
    expect(await isFallbackReplyDue(chat.chatbot, chat.sessionId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// BR-2: who can create an account.
// ---------------------------------------------------------------------------------------------

let signupIp = 0;
async function register(body: Record<string, unknown>) {
  signupIp += 1;
  const request = new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${(Date.now() + signupIp) % 250}` },
    body: JSON.stringify(body),
  });
  const response = await signup.POST(request);
  return { status: response.status, body: await response.json() };
}

describe("IT-15 BR-2 account registration - FR-1.1, FR-1.2, FR-1.3", () => {
  it("IT-15.01 R1 a complete, valid registration creates the account and opens setup", async () => {
    const email = `br-new-${suffix}@example.com`;
    signupEmails.push(email);
    const result = await register({ fullName: "Ayesha Khan", email, password: "Secure-Pass-2026" });
    expect(result.status).toBe(200);
    expect(result.body.redirectTo).toBe("/setup");
  });

  it("IT-15.02 R2 a registration without a full name is refused", async () => {
    const result = await register({ fullName: "  ", email: `br-noname-${suffix}@example.com`, password: "Secure-Pass-2026" });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/full name/i);
  });

  it("IT-15.03 R3 an email address in the wrong format is refused", async () => {
    const result = await register({ fullName: "Ayesha Khan", email: "ayesha.example.com", password: "Secure-Pass-2026" });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/valid email/i);
  });

  it("IT-15.04 R4 an email address that already has an account is refused", async () => {
    const email = `br-dup-${suffix}@example.com`;
    signupEmails.push(email);
    expect((await register({ fullName: "Ayesha Khan", email, password: "Secure-Pass-2026" })).status).toBe(200);
    const second = await register({ fullName: "Another Person", email, password: "Secure-Pass-2026" });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already exists/i);
  });

  it("IT-15.05 R5 a password shorter than 8 characters is refused", async () => {
    const result = await register({ fullName: "Ayesha Khan", email: `br-short-${suffix}@example.com`, password: "abc12" });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/at least 8/);
  });

  it("IT-15.06 R6 a password without a number is refused", async () => {
    const result = await register({ fullName: "Ayesha Khan", email: `br-letters-${suffix}@example.com`, password: "onlyletters" });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/letter and one number/);
  });
});

// ---------------------------------------------------------------------------------------------
// BR-3: the inbox email address.
// ---------------------------------------------------------------------------------------------

function asAdmin() {
  signedIn.current = { user: { id: teamMemberId, role: "ADMIN", workspaceId } };
}

async function checkPrefix(prefix: string) {
  const response = await inboxes.GET(new Request(`http://localhost/api/inboxes?emailPrefix=${encodeURIComponent(prefix)}`));
  return response.json();
}

async function createInbox(body: Record<string, unknown>) {
  const response = await inboxes.POST(new Request("http://localhost/api/inboxes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
}

describe("IT-16 BR-3 inbox email address - FR-2.1, FR-2.2, FR-2.3", () => {
  beforeEach(asAdmin);

  it("IT-16.01 R1 a free email prefix is shown as available", async () => {
    expect(await checkPrefix(`support-${suffix}`)).toEqual({ isAvailable: true, message: "Available." });
  });

  it("IT-16.02 R2 a prefix already used by another business is shown as taken", async () => {
    expect(await checkPrefix(`taken-${suffix}`)).toEqual({ isAvailable: false, message: "This inbox address is already taken." });
  });

  it("IT-16.03 R3 a prefix with no letters or digits is shown as invalid", async () => {
    expect((await checkPrefix("!!!")).isAvailable).toBe(false);
  });

  it("IT-16.04 R4 an inbox without a name is refused", async () => {
    const result = await createInbox({ name: " ", emailPrefix: `noname-${suffix}` });
    expect(result.status).toBe(400);
  });

  it("IT-16.05 R5 an inbox with a prefix that is already in use is refused", async () => {
    const result = await createInbox({ name: "Sales", emailPrefix: `taken-${suffix}` });
    expect(result.status).toBe(409);
  });

  it("IT-16.06 R6 spaces and symbols in a new prefix are turned into hyphens", async () => {
    const result = await createInbox({ name: "Sales Team", emailPrefix: `Sales Team ${suffix}!`, senderEmail: `sales-${suffix}@example.com` });
    expect(result.status).toBe(200);
    expect(result.body.inbox.emailPrefix).toBe(`sales-team-${suffix}`);
  });
});

// ---------------------------------------------------------------------------------------------
// BR-5: the AI may only answer from knowledge that meets the agent's confidence threshold.
// ---------------------------------------------------------------------------------------------

const warrantySource = {
  id: `br-source-${suffix}`,
  title: "Warranty policy",
  type: "TEXT" as const,
  status: "SYNCED",
  sourceUrl: null,
  rawText: "Every Kettle Pro has a 3-year warranty that covers the heating element, the switch and the thermostat.",
};

function promptFor(confidenceThreshold: number, sources = [warrantySource], question = "How long is the Kettle Pro warranty?") {
  return buildPrompt({
    agent: { provider: "Default", model: "groq/llama-3.3-70b-versatile", apiKey: null, systemPrompt: null, confidenceThreshold },
    question,
    sources,
    history: [],
    channel: "WEB_WIDGET",
  });
}

const knowledgeOf = (prompt: Awaited<ReturnType<typeof promptFor>>["prompt"]) => String(prompt.messages.at(-1)?.content ?? "");

describe("IT-17 BR-5 confidence threshold - FR-8.5", () => {
  it("IT-17.01 R1 a passage that meets the threshold is given to the AI to answer from", async () => {
    const { prompt, grounded } = await promptFor(0);
    expect(grounded.belowThreshold).toBe(false);
    expect(knowledgeOf(prompt)).toContain("3-year warranty");
  });

  it("IT-17.02 R2 a passage below the threshold is withheld and the AI must say it does not know", async () => {
    const { prompt, grounded } = await promptFor(1.01);
    expect(grounded.belowThreshold).toBe(true);
    expect(knowledgeOf(prompt)).not.toContain("3-year warranty");
    expect(knowledgeOf(prompt)).toContain("No knowledge passage was relevant enough");
  });

  it("IT-17.03 R3 with no knowledge sources the AI is told it has none", async () => {
    const { prompt, grounded } = await promptFor(0.5, []);
    expect(grounded.matches).toEqual([]);
    expect(knowledgeOf(prompt)).toContain("This assistant has no knowledge sources yet.");
  });
});
