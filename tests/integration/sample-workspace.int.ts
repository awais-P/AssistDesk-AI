import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * The sample workspace for a deployed site (one of everything, with test logins), created
 * through the operator-only route. Knowledge indexing is skipped (it needs an AI key).
 */

vi.mock("@/src/lib/knowledge-indexing", async (original) => ({
  ...(await original<typeof import("@/src/lib/knowledge-indexing")>()),
  processKnowledgeSourceById: async () => null,
}));

const route = await import("@/app/api/admin/sample-workspace/route");
const { verifyPassword } = await import("@/src/lib/auth");
const { SAMPLE_WORKSPACE_SLUG, SAMPLE_OWNER_EMAIL, SAMPLE_AGENT_EMAIL } = await import("@/src/lib/sample-workspace");

const SECRET = "fake-cron-secret-for-tests";
const call = (method: "POST" | "DELETE", token = SECRET) =>
  (method === "POST" ? route.POST : route.DELETE)(
    new Request("http://localhost/api/admin/sample-workspace", { method, headers: { authorization: `Bearer ${token}` } }),
  );

type Login = { role: string; email: string; password: string };

async function passwordFor(email: string) {
  const user = await prisma.user.findFirst({
    where: { email, workspace: { slug: SAMPLE_WORKSPACE_SLUG } },
    omit: { passwordHash: false },
  });
  return user;
}

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { slug: SAMPLE_WORKSPACE_SLUG } });
  vi.unstubAllEnvs();
});

describe("IT-29 sample workspace for a deployed site", () => {
  it("IT-29.01 only a caller with CRON_SECRET can create it", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("POST")).status).toBe(503);
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call("POST", "wrong-secret")).status).toBe(401);
    expect(await prisma.workspace.count({ where: { slug: SAMPLE_WORKSPACE_SLUG } })).toBe(0);
  });

  it("IT-29.02 creates one of everything with verified logins that work", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    await prisma.workspace.deleteMany({ where: { slug: SAMPLE_WORKSPACE_SLUG } });
    const response = await call("POST");
    expect(response.status).toBe(201);
    const body = (await response.json()) as { workspaceId: string; logins: Login[] };
    const workspaceId = body.workspaceId;

    expect(body.logins.map((login) => login.email)).toEqual([SAMPLE_OWNER_EMAIL, SAMPLE_AGENT_EMAIL]);
    for (const login of body.logins) {
      const user = await passwordFor(login.email);
      expect(user?.isEmailVerified).toBe(true);
      expect((await verifyPassword(login.password, user?.passwordHash ?? null)).valid).toBe(true);
    }

    const where = { workspaceId };
    const counts = await Promise.all([
      prisma.inbox.count({ where }),
      prisma.aIAgent.count({ where: { ...where, status: "ACTIVE" } }),
      prisma.chatbot.count({ where }),
      prisma.knowledgeSource.count({ where }),
      prisma.contact.count({ where }),
      prisma.chatSession.count({ where }),
      prisma.ticket.count({ where }),
      prisma.lead.count({ where }),
      prisma.escalation.count({ where }),
      prisma.appointment.count({ where }),
      prisma.customRole.count({ where }),
      prisma.integration.count({ where }),
      prisma.cannedResponse.count({ where }),
      prisma.aiInteraction.count({ where }),
    ]);
    expect(counts).toEqual([1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2]);
    expect(await prisma.agentAutomation.count({ where })).toBeGreaterThan(0);
    expect(await prisma.agentToolBinding.count({ where: { agent: { workspaceId } } })).toBeGreaterThan(0);
    expect(await prisma.ticketMessage.count({ where })).toBe(2);
    expect(await prisma.chatMessage.count({ where: { session: { workspaceId } } })).toBe(7);
  });

  it("IT-29.03 calling it again keeps the data and gives both logins a new password", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const before = await passwordFor(SAMPLE_OWNER_EMAIL);
    const response = await call("POST");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { created: boolean; logins: Login[] };
    expect(body.created).toBe(false);
    const after = await passwordFor(SAMPLE_OWNER_EMAIL);
    expect(after?.passwordHash).not.toBe(before?.passwordHash);
    expect((await verifyPassword(body.logins[0].password, after?.passwordHash ?? null)).valid).toBe(true);
    expect(await prisma.ticket.count({ where: { workspace: { slug: SAMPLE_WORKSPACE_SLUG } } })).toBe(1);
  });

  it("IT-29.04 DELETE removes the workspace and everything in it", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const workspace = await prisma.workspace.findUnique({ where: { slug: SAMPLE_WORKSPACE_SLUG }, select: { id: true } });
    expect(await (await call("DELETE")).json()).toEqual({ deleted: true });
    expect(await prisma.user.count({ where: { workspaceId: workspace?.id } })).toBe(0);
    expect(await prisma.ticket.count({ where: { workspaceId: workspace?.id } })).toBe(0);
    expect(await (await call("DELETE")).json()).toEqual({ deleted: false });
  });
});
