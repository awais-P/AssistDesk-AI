import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Module 11 FE-3 / FE-4: admin-defined roles. A role starts from a built-in level and
 * adds or removes permissions; the routes that check those permissions follow it, and
 * every change is audited. The signed-in user is loaded with their custom role exactly
 * as `getCurrentSession` does.
 */

type SessionUser = { id: string; role: string; workspaceId: string; fullName: string; customRole: { id: string; name: string; permissions: string[]; deniedPermissions: string[] } | null };
const signedIn: { current: { user: SessionUser } | null } = { current: null };

vi.mock("@/src/lib/auth", async (original) => ({
  ...(await original<typeof import("@/src/lib/auth")>()),
  getCurrentSession: async () => signedIn.current,
}));

const { settleAudits } = await import("@/src/lib/audit");
const roles = await import("@/app/api/roles/route");
const roleById = await import("@/app/api/roles/[id]/route");
const userById = await import("@/app/api/users/[id]/route");
const leadsExport = await import("@/app/api/leads/export/route");
const knowledge = await import("@/app/api/knowledge-sources/route");

const suffix = Date.now().toString(36);
let workspaceId = "";
const ids = { admin: "", manager: "", agent: "" };
let seniorRoleId = "";

async function signIn(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { customRole: { select: { id: true, name: true, permissions: true, deniedPermissions: true } } },
  });
  signedIn.current = { user: { id: user.id, role: user.role, workspaceId: user.workspaceId, fullName: user.fullName, customRole: user.customRole } };
}

const json = (body: unknown, method = "POST") => new Request("http://localhost/api", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  workspaceId = (await prisma.workspace.create({ data: { name: `Roles ${suffix}`, slug: `roles-${suffix}` } })).id;
  for (const role of ["admin", "manager", "agent"] as const) {
    ids[role] = (
      await prisma.user.create({ data: { workspaceId, fullName: `${role} ${suffix}`, username: `${role}-roles-${suffix}`, email: `${role}-roles-${suffix}@example.com`, role: role.toUpperCase() as "ADMIN" | "MANAGER" | "AGENT" } })
    ).id;
  }
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.$disconnect();
});

describe("IT-25 custom roles and permissions - Module 11 FE-3, FE-4", () => {
  it("IT-25.01 only admins manage roles, and invalid roles are refused", async () => {
    await signIn(ids.manager);
    expect((await roles.POST(json({ name: "Senior agent", baseRole: "AGENT", permissions: [] }))).status).toBe(403);

    await signIn(ids.admin);
    expect((await roles.POST(json({ name: "Agent", baseRole: "AGENT" }))).status).toBe(400);
    expect((await roles.POST(json({ name: "Key keeper", baseRole: "AGENT", permissions: ["apikeys.manage"] }))).status).toBe(400);
    const created = await roles.POST(json({ name: "Senior agent", description: "Exports and assigns", baseRole: "AGENT", permissions: ["data.export", "escalations.assign"], deniedPermissions: [] }));
    expect(created.status).toBe(201);
    seniorRoleId = (await created.json()).role.id;
    expect((await roles.POST(json({ name: "Senior agent", baseRole: "AGENT" }))).status).toBe(409);

    const listed = await (await roles.GET(new Request("http://localhost/api/roles"))).json();
    expect(listed.permissions).toHaveLength(9);
    expect(listed.roles[0]).toMatchObject({ name: "Senior agent", permissions: ["data.export", "escalations.assign"] });
  });

  it("IT-25.02 giving a member a custom role sets their level and is audited", async () => {
    await signIn(ids.admin);
    const response = await userById.PATCH(json({ customRoleId: seniorRoleId }, "PATCH"), params(ids.agent));
    expect(response.status).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: ids.agent } })).toMatchObject({ role: "AGENT", customRoleId: seniorRoleId });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { workspaceId, action: "user.custom_role_changed" } })).summary).toContain('"Senior agent"');
  });

  it("IT-25.03 the added permission works: a senior agent can export leads, a plain agent cannot", async () => {
    await signIn(ids.agent);
    expect((await leadsExport.GET(new Request("http://localhost/api/leads/export"))).status).toBe(200);

    await prisma.user.update({ where: { id: ids.agent }, data: { customRoleId: null } });
    await signIn(ids.agent);
    expect((await leadsExport.GET(new Request("http://localhost/api/leads/export"))).status).toBe(403);
  });

  it("IT-25.04 a removed permission works too, and the refusal is logged", async () => {
    await signIn(ids.admin);
    const limited = await (await roles.POST(json({ name: "Reporting manager", baseRole: "MANAGER", permissions: [], deniedPermissions: ["knowledge.manage"] }))).json();
    await userById.PATCH(json({ customRoleId: limited.role.id }, "PATCH"), params(ids.manager));

    await signIn(ids.manager);
    expect(signedIn.current?.user.role).toBe("MANAGER");
    expect((await knowledge.POST(json({ type: "TEXT", title: "Returns", content: "30 days" }))).status).toBe(403);
    expect((await leadsExport.GET(new Request("http://localhost/api/leads/export"))).status).toBe(200);
    await settleAudits();
    expect(await prisma.auditLog.findFirst({ where: { workspaceId, actorId: ids.manager, action: "access.denied", summary: { contains: "knowledge" } } })).toMatchObject({ metadata: { permission: "knowledge.manage" } });
  });

  it("IT-25.05 a new base level reaches every member; deleting the role keeps their level", async () => {
    await signIn(ids.admin);
    await userById.PATCH(json({ customRoleId: seniorRoleId }, "PATCH"), params(ids.agent));
    expect((await roleById.PATCH(json({ name: "Senior agent", baseRole: "MANAGER", permissions: [], deniedPermissions: [] }, "PATCH"), params(seniorRoleId))).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.agent } })).role).toBe("MANAGER");

    expect((await roleById.DELETE(json({}, "DELETE"), params(seniorRoleId))).status).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: ids.agent } })).toMatchObject({ role: "MANAGER", customRoleId: null });
    expect(await prisma.auditLog.count({ where: { workspaceId, action: { in: ["role.created", "role.updated", "role.deleted"] } } })).toBe(4);
  });

  it("IT-25.06 a member cannot be given a custom role above the admin's own level", async () => {
    const adminRole = await prisma.customRole.create({ data: { workspaceId, name: "Deputy admin", baseRole: "ADMIN", permissions: [], deniedPermissions: [] } });
    await signIn(ids.admin);
    expect((await userById.PATCH(json({ customRoleId: adminRole.id }, "PATCH"), params(ids.agent))).status).toBe(403);
  });
});
