import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Module 11 FE-5 and FE-3: the security & audit log written by real route handlers
 * (sign-in, team changes, refused access, exports), read through its API with
 * filters and permissions, and protected against changes by the database.
 */

type SignedIn = {
  user: { id: string; role: string; workspaceId: string; fullName: string; customRole?: { permissions: string[]; deniedPermissions: string[] } | null };
};
const signedIn: { current: SignedIn | null } = { current: null };

vi.mock("@/src/lib/auth", async (original) => ({
  ...(await original<typeof import("@/src/lib/auth")>()),
  getCurrentSession: async () => signedIn.current,
}));

await import("@/src/lib/access"); // installs the refused-access hook, as the server does at start
const { hashPassword } = await import("@/src/lib/auth");
const { settleAudits } = await import("@/src/lib/audit");
const login = await import("@/app/api/auth/login/route");
const userById = await import("@/app/api/users/[id]/route");
const settings = await import("@/app/api/settings/route");
const auditLogs = await import("@/app/api/audit-logs/route");

const suffix = Date.now().toString(36);
let workspaceId = "";
let otherWorkspaceId = "";
const admin = { id: "", fullName: "Amna Admin", email: `amna-${suffix}@example.com` };
const agent = { id: "", fullName: "Sana Agent", email: `sana-${suffix}@example.com` };
const temp = { id: "", fullName: "Temp Helper", email: `temp-${suffix}@example.com` };
const PASSWORD = "Correct-horse-42";

function as(user: { id: string; fullName: string }, role: string, customRole: SignedIn["user"]["customRole"] = null, workspace = workspaceId) {
  signedIn.current = { user: { id: user.id, fullName: user.fullName, role, workspaceId: workspace, customRole } };
}

const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/api", { method, headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", "user-agent": "vitest" }, body: JSON.stringify(body) });
const get = (url: string) => new Request(`http://localhost${url}`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const entries = (where: Record<string, unknown>) => prisma.auditLog.findMany({ where: { workspaceId, ...where }, orderBy: { createdAt: "desc" } });

beforeAll(async () => {
  workspaceId = (await prisma.workspace.create({ data: { name: `Audit ${suffix}`, slug: `audit-${suffix}` } })).id;
  otherWorkspaceId = (await prisma.workspace.create({ data: { name: `Audit other ${suffix}`, slug: `audit-other-${suffix}` } })).id;
  const passwordHash = await hashPassword(PASSWORD);
  admin.id = (await prisma.user.create({ data: { workspaceId, fullName: admin.fullName, username: `amna-${suffix}`, email: admin.email, role: "ADMIN", passwordHash, isEmailVerified: true, emailVerified: new Date() } })).id;
  agent.id = (await prisma.user.create({ data: { workspaceId, fullName: agent.fullName, username: `sana-${suffix}`, email: agent.email, role: "AGENT" } })).id;
  temp.id = (await prisma.user.create({ data: { workspaceId, fullName: temp.fullName, username: `temp-${suffix}`, email: temp.email, role: "AGENT" } })).id;
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
  await prisma.$disconnect();
});

describe("IT-22 security and audit log - Module 11 FE-5, FE-3", () => {
  it("IT-22.01 sign-ins and wrong passwords are logged with a hashed network address", async () => {
    expect((await login.POST(json({ email: admin.email, password: "wrong-password" }))).status).toBe(401);
    expect((await login.POST(json({ email: admin.email, password: PASSWORD }))).status).toBe(200);

    const [ok] = await entries({ action: "auth.login" });
    const [failed] = await entries({ action: "auth.login_failed" });
    expect(ok).toMatchObject({ actorId: admin.id, outcome: "SUCCESS", category: "auth", userAgent: "vitest" });
    expect(ok.ipHash).toMatch(/^[\w-]{32}$/);
    expect(ok.ipHash).not.toContain("203.0.113.7");
    expect(failed).toMatchObject({ actorId: admin.id, outcome: "FAILED" });
  });

  it("IT-22.02 role changes and removals record who, whom and the before/after", async () => {
    as(admin, "ADMIN");
    expect((await userById.PATCH(json({ role: "MANAGER" }, "PATCH"), params(agent.id))).status).toBe(200);
    expect((await userById.DELETE(json({}, "DELETE"), params(temp.id))).status).toBe(200);

    const [changed] = await entries({ action: "user.role_changed" });
    expect(changed).toMatchObject({ actorId: admin.id, targetId: agent.id, metadata: { from: "AGENT", to: "MANAGER" } });
    expect(changed.summary).toContain("from agent to manager");
    const [removed] = await entries({ action: "user.deleted" });
    expect(removed).toMatchObject({ targetId: temp.id, metadata: { email: temp.email } });
  });

  it("IT-22.03 an action refused by role is logged as DENIED", async () => {
    as(agent, "AGENT");
    expect((await settings.PATCH(json({ workspaceName: "Hacked", supportEmail: "x@example.com" }, "PATCH"))).status).toBe(403);
    await settleAudits();
    const [denied] = await entries({ action: "access.denied", actorId: agent.id });
    expect(denied).toMatchObject({ outcome: "DENIED", category: "access", metadata: { needed: "ADMIN", role: "AGENT" } });
  });

  it("IT-22.04 the audit log is for admins; a refused look is itself logged", async () => {
    as(agent, "MANAGER");
    expect((await auditLogs.GET(get("/api/audit-logs"))).status).toBe(403);
    await settleAudits();
    const [denied] = await entries({ action: "access.denied", actorId: agent.id, outcome: "DENIED" });
    expect(denied.metadata).toMatchObject({ permission: "audit.view", path: "/api/audit-logs" });
  });

  it("IT-22.05 an admin reads the log with filters, and only their own workspace's entries", async () => {
    as(admin, "ADMIN");
    const all = await (await auditLogs.GET(get("/api/audit-logs"))).json();
    expect(all.total).toBeGreaterThanOrEqual(6);
    expect(all.summary).toMatchObject({ failedLogins7d: 1 });
    expect(all.summary.denied7d).toBeGreaterThanOrEqual(2);
    expect(all.actors.map((actor: { id: string }) => actor.id)).toContain(agent.id);

    const denied = await (await auditLogs.GET(get("/api/audit-logs?outcome=DENIED"))).json();
    expect(denied.entries.every((entry: { outcome: string }) => entry.outcome === "DENIED")).toBe(true);
    const search = await (await auditLogs.GET(get("/api/audit-logs?q=manager&category=users"))).json();
    expect(search.entries).toHaveLength(1);

    as(admin, "ADMIN", null, otherWorkspaceId);
    expect((await (await auditLogs.GET(get("/api/audit-logs"))).json()).total).toBe(0);
  });

  it("IT-22.06 exporting the log needs the export permission and is logged too", async () => {
    as(agent, "AGENT", { permissions: ["audit.view"], deniedPermissions: [] });
    expect((await auditLogs.GET(get("/api/audit-logs"))).status).toBe(200);
    expect((await auditLogs.GET(get("/api/audit-logs?format=csv"))).status).toBe(403);

    as(admin, "ADMIN");
    const response = await auditLogs.GET(get("/api/audit-logs?format=csv"));
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect((await response.text()).split("\r\n")[0]).toBe("Time (UTC),Actor,Actor type,Action,Category,Outcome,Target type,Target id,Summary,Details,IP (hashed),User agent");
    expect((await entries({ action: "data.exported" }))[0].summary).toContain("exported the audit log");
  });

  it("IT-22.07 entries cannot be changed, not even directly in the database", async () => {
    const [entry] = await entries({});
    await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { summary: "nothing happened" } })).rejects.toThrow();
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).summary).toBe(entry.summary);
  });
});
