import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Module 9 APIs called as route handlers with a signed-in user of a chosen role: the
 * queue, accept / assign / resolve with their permissions, the escalation settings,
 * the CSV export, and the Chats take-over / hand-back buttons now creating and
 * resolving escalations.
 */

process.env.ASSISTDESK_ESCALATION_SUMMARY = "off";

type SignedIn = { user: { id: string; role: string; workspaceId: string; fullName: string } };
const signedIn: { current: SignedIn | null } = { current: null };

vi.mock("@/src/lib/auth", () => ({ getCurrentSession: async () => signedIn.current }));
vi.mock("@/src/lib/integrations/channel-outbound", () => ({ deliverAgentMessageToChannel: async () => ({ delivered: false }) }));

const list = await import("@/app/api/escalations/route");
const byId = await import("@/app/api/escalations/[id]/route");
const settings = await import("@/app/api/escalations/settings/route");
const sessionRoute = await import("@/app/api/chat-sessions/[id]/route");
const replyRoute = await import("@/app/api/chat-sessions/[id]/messages/route");
const { openEscalation } = await import("@/src/lib/escalation");

const suffix = Date.now().toString(36);
let workspaceId = "";
let otherWorkspaceId = "";
const users: Record<"ADMIN" | "MANAGER" | "AGENT" | "AGENT2", { id: string; fullName: string }> = {
  ADMIN: { id: "", fullName: "Amna Admin" },
  MANAGER: { id: "", fullName: "Bilal Manager" },
  AGENT: { id: "", fullName: "Sana Agent" },
  AGENT2: { id: "", fullName: "Usman Agent" },
};

function as(key: keyof typeof users, workspace = workspaceId) {
  const role = key === "AGENT2" ? "AGENT" : key;
  signedIn.current = { user: { id: users[key].id, role, workspaceId: workspace, fullName: users[key].fullName } };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown) => new Request("http://localhost/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const post = (body: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function pendingEscalation(name = "Ali Raza") {
  const sessionId = (await prisma.chatSession.create({ data: { workspaceId, channel: "WEB_WIDGET", customerName: name } })).id;
  const { escalation } = await openEscalation({ workspaceId, sessionId, trigger: "HUMAN_REQUEST", reason: "Customer asked for a person" });
  return { sessionId, id: escalation.id };
}

beforeAll(async () => {
  workspaceId = (await prisma.workspace.create({ data: { name: `Escalation API ${suffix}`, slug: `escalation-api-${suffix}` } })).id;
  otherWorkspaceId = (await prisma.workspace.create({ data: { name: `Other ${suffix}`, slug: `escalation-other-${suffix}` } })).id;

  for (const key of Object.keys(users) as Array<keyof typeof users>) {
    const role = key === "AGENT2" ? "AGENT" : key;
    users[key].id = (
      await prisma.user.create({ data: { workspaceId, fullName: users[key].fullName, username: `${key.toLowerCase()}-${suffix}`, email: `${key.toLowerCase()}-${suffix}@example.com`, role } })
    ).id;
  }
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
  await prisma.$disconnect();
});

describe("IT-21 escalation API and permissions - Module 9 FE-4, FE-6", () => {
  it("IT-21.01 the queue lists waiting escalations with the stats and the team", async () => {
    const { id } = await pendingEscalation();
    as("AGENT");
    const response = await list.GET(new Request("http://localhost/api/escalations?view=queue"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items.map((item: { id: string }) => item.id)).toContain(id);
    expect(body.items[0]).toMatchObject({ status: "PENDING", triggerLabel: "Asked for a person", customer: "Ali Raza", link: expect.stringContaining("/dashboard/chats?session=") });
    expect(body.stats.pending).toBeGreaterThan(0);
    expect(body.members).toHaveLength(4);
  });

  it("IT-21.02 an agent accepts from the queue; another agent cannot take it, a manager can", async () => {
    const { id } = await pendingEscalation();
    as("AGENT");
    expect((await byId.PATCH(patch({ action: "accept" }), params(id))).status).toBe(200);

    as("AGENT2");
    expect((await byId.PATCH(patch({ action: "accept" }), params(id))).status).toBe(409);
    expect((await byId.PATCH(patch({ action: "accept", force: true }), params(id))).status).toBe(403);

    as("MANAGER");
    const taken = await byId.PATCH(patch({ action: "accept", force: true }), params(id));
    expect((await taken.json()).escalation.assignee.id).toBe(users.MANAGER.id);
  });

  it("IT-21.03 only a manager assigns escalations", async () => {
    const { id } = await pendingEscalation();
    as("AGENT");
    expect((await byId.PATCH(patch({ action: "assign", assigneeId: users.AGENT.id }), params(id))).status).toBe(403);

    as("MANAGER");
    const assigned = await byId.PATCH(patch({ action: "assign", assigneeId: users.AGENT2.id }), params(id));
    expect((await assigned.json()).escalation).toMatchObject({ status: "ACCEPTED", assignee: { id: users.AGENT2.id } });
  });

  it("IT-21.04 an agent resolves only their own escalation; the outcome is validated", async () => {
    const { id, sessionId } = await pendingEscalation();
    as("AGENT");
    await byId.PATCH(patch({ action: "accept" }), params(id));

    as("AGENT2");
    expect((await byId.PATCH(patch({ action: "resolve", outcome: "HANDED_BACK" }), params(id))).status).toBe(403);

    as("AGENT");
    expect((await byId.PATCH(patch({ action: "resolve", outcome: "SOMETHING" }), params(id))).status).toBe(400);
    const done = await byId.PATCH(patch({ action: "resolve", outcome: "CLOSED", note: "Replacement sent" }), params(id));
    expect((await done.json()).escalation).toMatchObject({ status: "RESOLVED", resolution: "CLOSED", resolutionNote: "Replacement sent" });
    expect((await prisma.chatSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("CLOSED");
  });

  it("IT-21.05 another workspace cannot see or act on an escalation", async () => {
    const { id } = await pendingEscalation();
    as("ADMIN", otherWorkspaceId);
    expect((await byId.GET(new Request("http://localhost"), params(id))).status).toBe(404);
    expect((await byId.PATCH(patch({ action: "accept" }), params(id))).status).toBe(404);
  });

  it("IT-21.06 only an admin changes the escalation settings, and invalid values are refused", async () => {
    as("MANAGER");
    expect((await settings.PATCH(patch({ slaMinutes: 5 }))).status).toBe(403);

    as("ADMIN");
    expect((await settings.PATCH(patch({ slaMinutes: 0 }))).status).toBe(400);
    const saved = await settings.PATCH(patch({ slaMinutes: 5, sentimentThreshold: -0.7, keywords: ["Refund", "warranty claim"] }));
    expect((await saved.json()).settings).toMatchObject({ slaMinutes: 5, sentimentThreshold: -0.7, keywords: ["refund", "warranty claim"] });

    as("AGENT");
    expect((await (await settings.GET()).json()).settings.slaMinutes).toBe(5);
    await prisma.workspaceSetting.update({ where: { workspaceId }, data: { escalationSlaMinutes: 15, escalationKeywords: [] } });
  });

  it("IT-21.07 the escalations download as CSV", async () => {
    await pendingEscalation("Hina Baig");
    as("AGENT");
    const response = await list.GET(new Request("http://localhost/api/escalations?view=all&format=csv"));

    expect(response.headers.get("content-type")).toContain("text/csv");
    const csv = await response.text();
    expect(csv.split("\r\n")[0]).toContain("Created,Customer,Channel,Trigger,Reason");
    expect(csv).toContain("Hina Baig");
  });

  it("IT-21.08 Take over in Chats creates an escalation the team member owns; Hand back resolves it", async () => {
    const sessionId = (await prisma.chatSession.create({ data: { workspaceId, channel: "WHATSAPP", customerName: "Kamran" } })).id;
    as("AGENT");
    expect((await sessionRoute.PATCH(patch({ status: "ESCALATED" }), params(sessionId))).status).toBe(200);
    const [taken] = await prisma.escalation.findMany({ where: { sessionId } });
    expect(taken).toMatchObject({ trigger: "MANUAL", status: "ACCEPTED", assigneeId: users.AGENT.id, slaDueAt: null });

    expect((await sessionRoute.PATCH(patch({ status: "ACTIVE" }), params(sessionId))).status).toBe(200);
    expect(await prisma.escalation.findUniqueOrThrow({ where: { id: taken.id } })).toMatchObject({ status: "RESOLVED", resolution: "HANDED_BACK" });
    expect((await prisma.chatSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("ACTIVE");
  });

  it("IT-21.09 replying to a conversation the AI handed over accepts its escalation", async () => {
    const { id, sessionId } = await pendingEscalation("Zara");
    as("AGENT2");
    expect((await replyRoute.POST(post({ content: "Hi Zara, I'm here to help." }), params(sessionId))).status).toBe(200);
    expect(await prisma.escalation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "ACCEPTED", assigneeId: users.AGENT2.id });
  });
});
