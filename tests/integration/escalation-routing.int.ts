import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Module 9: escalation alerts (email and Slack) and round-robin routing, against a real
 * database. Email is replaced by a recorder and Slack by a fake behind `fetch`; the
 * escalation lifecycle, the settings routes, the permission checks and the SLA check
 * are real.
 */

process.env.ASSISTDESK_ESCALATION_SUMMARY = "off";

type SignedIn = { user: { id: string; role: string; workspaceId: string; fullName: string; customRole?: null } };
const signedIn: { current: SignedIn | null } = { current: null };

vi.mock("@/src/lib/auth", async (original) => ({
  ...(await original<typeof import("@/src/lib/auth")>()),
  getCurrentSession: async () => signedIn.current,
}));

const emails: Array<{ to: string[]; subject: string; text: string }> = [];
vi.mock("@/src/lib/mailer", async (original) => ({
  ...(await original<typeof import("@/src/lib/mailer")>()),
  isPlatformEmailConfigured: () => true,
  sendTeamEmail: async (message: { to: string[]; subject: string; text: string }) => {
    emails.push(message);
    return { status: "SENT", error: null };
  },
}));

// Plainly fake Slack webhook for tests.
const SLACK_URL = "https://hooks.slack.com/services/TFAKE/BFAKE/fake-slack-hook-for-tests";
const slack = { posts: [] as string[], failing: false };
vi.stubGlobal(
  "fetch",
  vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== SLACK_URL) return new Response("unexpected call in test", { status: 404 });
    if (slack.failing) return new Response("no_service", { status: 404 });
    slack.posts.push(JSON.parse(String(init?.body)).text);
    return new Response("ok", { status: 200 });
  }),
);

const escalation = await import("@/src/lib/escalation");
const alertsRoute = await import("@/app/api/escalations/alerts/route");
const testRoute = await import("@/app/api/escalations/alerts/test/route");

const suffix = Date.now().toString(36);
const people = { admin: "", sana: "", bilal: "", omar: "", rida: "" };
let workspaceId = "";

const asUser = (id: string, role: string, fullName = "Team Member") => (signedIn.current = { user: { id, role, workspaceId, fullName } });
const patch = (body: unknown) => alertsRoute.PATCH(new Request("http://localhost/api/escalations/alerts", { method: "PATCH", body: JSON.stringify(body) }));
const online = (...ids: string[]) => prisma.user.updateMany({ where: { id: { in: ids } }, data: { lastSeenAt: new Date() } });
const offline = (...ids: string[]) => prisma.user.updateMany({ where: { id: { in: ids } }, data: { lastSeenAt: new Date(Date.now() - 60 * 60_000) } });

async function waitFor(check: () => boolean) {
  for (let index = 0; index < 100; index += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("timed out");
}

let customers = 0;
/** A customer asks for a person in a new conversation; returns the escalation. */
async function escalate(priority: "MEDIUM" | "URGENT" = "MEDIUM") {
  customers += 1;
  const session = await prisma.chatSession.create({ data: { workspaceId, channel: "WHATSAPP", customerName: `Customer ${customers}` } });
  const result = await escalation.openEscalation({ workspaceId, sessionId: session.id, trigger: "HUMAN_REQUEST", reason: "Asked to talk to a person", priority });
  return result.escalation;
}

beforeAll(async () => {
  workspaceId = (await prisma.workspace.create({ data: { name: `Routing ${suffix}`, slug: `routing-${suffix}` } })).id;
  const user = async (key: keyof typeof people, role: "ADMIN" | "MANAGER" | "AGENT", customRoleId?: string) =>
    (people[key] = (await prisma.user.create({ data: { workspaceId, fullName: `${key[0].toUpperCase()}${key.slice(1)} ${suffix}`, username: `rt-${key}-${suffix}`, email: `rt-${key}-${suffix}@example.com`, role, customRoleId } })).id);
  // A custom role that may not handle conversations.
  const noChats = await prisma.customRole.create({ data: { workspaceId, name: "Reports only", baseRole: "AGENT", permissions: [], deniedPermissions: ["tickets.handle"] } });
  await user("admin", "ADMIN");
  await user("sana", "AGENT");
  await user("bilal", "MANAGER");
  await user("omar", "AGENT");
  await user("rida", "AGENT", noChats.id);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.$disconnect();
});

describe("IT-35 escalation alerts and routing - Module 9", () => {
  it("IT-35.01 only people with the escalation-settings permission change alerts; bad values are refused and the Slack URL is kept secret", async () => {
    asUser(people.sana, "AGENT");
    expect((await patch({ notifyEmails: ["lead@example.com"] })).status).toBe(403);

    asUser(people.admin, "ADMIN", "Admin User");
    expect((await patch({ notifyEmails: ["not-an-email"] })).status).toBe(400);
    expect((await patch({ slackWebhookUrl: "https://example.com/hook" })).status).toBe(400);
    expect((await patch({ routing: "RANDOM" })).status).toBe(400);
    expect((await patch({ routingUserIds: ["someone-from-another-workspace"] })).status).toBe(400);

    const saved = await patch({ notifyEmails: ["Lead@Example.com", "lead@example.com", "ops@example.com"], slackWebhookUrl: SLACK_URL });
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.settings).toMatchObject({ notifyEmails: ["lead@example.com", "ops@example.com"], slackConfigured: true, routing: "QUEUE" });
    expect(JSON.stringify(body)).not.toContain("fake-slack-hook-for-tests");
    // People who can't handle conversations aren't offered for the rotation.
    expect(body.members.map((member: { id: string }) => member.id)).not.toContain(people.rida);

    const row = await prisma.workspaceSetting.findUniqueOrThrow({ where: { workspaceId } });
    expect(row.escalationSlackWebhookUrl).not.toContain("fake-slack-hook-for-tests");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId, action: "settings.escalation_alerts_updated" } });
    expect(JSON.stringify(audit.metadata)).not.toContain("hooks.slack.com");
  });

  it("IT-35.02 with the shared queue, a new escalation waits unassigned and the team is emailed and told in Slack", async () => {
    const sent = emails.length;
    const posted = slack.posts.length;
    const open = await escalate();
    expect(open).toMatchObject({ status: "PENDING", assigneeId: null });

    await waitFor(() => emails.length > sent && slack.posts.length > posted);
    expect(emails.at(-1)).toMatchObject({ to: ["lead@example.com", "ops@example.com"], subject: `Escalation: Customer ${customers} on WhatsApp` });
    expect(slack.posts.at(-1)).toMatch(/Waiting in the queue: accept within 15 min/);
    expect(slack.posts.at(-1)).toContain(`/dashboard/escalations?id=${open.id}`);
  });

  it("IT-35.03 'only high and urgent' skips routine escalations but not urgent ones", async () => {
    asUser(people.admin, "ADMIN", "Admin User");
    await patch({ urgentOnly: true });
    const posted = slack.posts.length;

    await escalate("MEDIUM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(slack.posts.length).toBe(posted);

    await escalate("URGENT");
    await waitFor(() => slack.posts.length > posted);
    expect(slack.posts.at(-1)).toMatch(/^Urgent escalation:/);
    await patch({ urgentOnly: false });
  });

  it("IT-35.04 round-robin takes turns among the people online who handle conversations, and emails the one picked", async () => {
    await online(people.sana, people.bilal, people.rida);
    await offline(people.omar, people.admin);
    asUser(people.admin, "ADMIN", "Admin User");
    expect((await patch({ routing: "ROUND_ROBIN", onlineOnly: true })).status).toBe(200);

    const sent = emails.length;
    const routed = [await escalate(), await escalate(), await escalate(), await escalate()];
    const assignees = routed.map((item) => item.assigneeId);
    // Alternates between the two online agents; never the offline one or the one who can't handle chats.
    expect(new Set(assignees)).toEqual(new Set([people.sana, people.bilal]));
    expect(assignees[0]).not.toBe(assignees[1]);
    expect(assignees[0]).toBe(assignees[2]);
    expect(assignees[1]).toBe(assignees[3]);
    // Still waiting for them to accept, so the deadline applies.
    for (const item of routed) {
      expect(item.status).toBe("PENDING");
      expect(item.slaDueAt).not.toBeNull();
    }

    expect(await prisma.sessionEvent.count({ where: { sessionId: routed[0].sessionId!, type: "ESCALATION_ROUTED" } })).toBe(1);
    expect((await prisma.notification.findFirstOrThrow({ where: { workspaceId, type: "ESCALATION_CREATED" }, orderBy: { createdAt: "desc" } })).title).toMatch(/\(assigned to (Sana|Bilal) /);
    await waitFor(() => emails.slice(sent).filter((email) => email.subject.startsWith("An escalation was assigned to you")).length === 4);
    const personal = emails.slice(sent).filter((email) => email.subject.startsWith("An escalation was assigned to you"));
    expect(new Set(personal.map((email) => email.to[0]))).toEqual(new Set([`rt-sana-${suffix}@example.com`, `rt-bilal-${suffix}@example.com`]));
  });

  it("IT-35.05 with nobody online it waits in the queue; a chosen rotation can include people who are offline", async () => {
    await offline(people.sana, people.bilal, people.rida);
    expect((await escalate()).assigneeId).toBeNull();

    asUser(people.admin, "ADMIN", "Admin User");
    await patch({ routingUserIds: [people.omar], onlineOnly: false });
    expect((await escalate()).assigneeId).toBe(people.omar);
  });

  it("IT-35.06 the assignee accepts it; anyone can still step in on one that is only assigned", async () => {
    const [first, second] = await prisma.escalation.findMany({ where: { workspaceId, status: "PENDING", assigneeId: { not: null } }, orderBy: { createdAt: "asc" }, take: 2 });
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: first.assigneeId! } });
    expect((await escalation.acceptEscalation({ workspaceId, escalationId: first.id, actor: { id: owner.id, fullName: owner.fullName } })).status).toBe("ACCEPTED");

    const colleague = second.assigneeId === people.sana ? people.bilal : people.sana;
    const taken = await escalation.acceptEscalation({ workspaceId, escalationId: second.id, actor: { id: colleague, fullName: "Colleague" } });
    expect(taken).toMatchObject({ status: "ACCEPTED", assigneeId: colleague });
  });

  it("IT-35.07 a missed deadline alerts the team by email and Slack, naming who it was assigned to", async () => {
    const overdue = await prisma.escalation.findFirstOrThrow({ where: { workspaceId, status: "PENDING", assigneeId: people.omar } });
    await prisma.escalation.update({ where: { id: overdue.id }, data: { slaDueAt: new Date(Date.now() - 60_000), createdAt: new Date(Date.now() - 20 * 60_000) } });
    const posted = slack.posts.length;
    const sent = emails.length;

    await escalation.checkEscalationSla();
    expect(slack.posts.slice(posted).some((text) => /^Overdue escalation: Customer \d+ has waited 20 min for a person/.test(text) && text.includes(`Omar ${suffix}, who hasn't accepted it yet`))).toBe(true);
    expect(emails.slice(sent).some((email) => email.subject.startsWith("Overdue escalation:"))).toBe(true);
  });

  it("IT-35.08 a failing Slack hook raises one dashboard warning; the test button reports each channel", async () => {
    asUser(people.admin, "ADMIN", "Admin User");
    await patch({ routing: "QUEUE" });
    slack.failing = true;
    await escalate();
    await escalate();
    // The alerts run in the background.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await prisma.notification.count({ where: { workspaceId, type: "ESCALATION_NOTIFY_FAILED" } })).toBe(1);

    const tested = await (await testRoute.POST(new Request("http://localhost", { method: "POST" }))).json();
    expect(tested.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ channel: "email", ok: true }), expect.objectContaining({ channel: "slack", ok: false })]),
    );
    slack.failing = false;

    await patch({ notifyEmails: [], slackWebhookUrl: null });
    expect((await testRoute.POST(new Request("http://localhost", { method: "POST" }))).status).toBe(400);
  });
});
