import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";
import { decryptSecret } from "@/src/lib/secrets";
import { parseToolHeaders } from "@/src/lib/tools/tool-schema";

/**
 * Module 2 increment 3: the admin APIs (tools CRUD + test, agent tool settings,
 * appointments) called as route handlers with a signed-in user of a chosen role.
 */

const signedIn: { current: { user: { id: string; role: string; workspaceId: string } } | null } = { current: null };

vi.mock("@/src/lib/auth", () => ({ getCurrentSession: async () => signedIn.current }));

const tools = await import("@/app/api/tools/route");
const toolById = await import("@/app/api/tools/[id]/route");
const toolTest = await import("@/app/api/tools/[id]/test/route");
const agentTools = await import("@/app/api/ai-agents/[id]/tools/route");
const appointments = await import("@/app/api/appointments/route");
const appointmentById = await import("@/app/api/appointments/[id]/route");
const appointmentSettings = await import("@/app/api/appointments/settings/route");
const appointmentSlots = await import("@/app/api/appointments/slots/route");

const suffix = Date.now().toString(36);
let workspaceId = "";
let agentId = "";
let otherWorkspaceId = "";
let server: http.Server;
let baseUrl = "";
const received: Array<{ url: string; auth: string | undefined }> = [];

function as(role: string) {
  signedIn.current = { user: { id: `user-${role}`, role, workspaceId } };
}

function json(body: unknown, method = "POST") {
  return new Request("http://localhost/api", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const trackOrder = () => ({
  name: "Track order",
  description: "Get the delivery status of an order from its number.",
  parameters: [{ name: "order_number", type: "string", description: "Order number", required: true }],
  httpMethod: "GET",
  httpUrl: `${baseUrl}/orders/{order_number}`,
  httpHeaders: [{ name: "Authorization", value: "Bearer s3cret-token-9876", secret: true }, { name: "X-Shop", value: "main", secret: false }],
  responseFields: ["status", "eta"],
});

beforeAll(async () => {
  server = http.createServer((request, response) => {
    received.push({ url: request.url ?? "", auth: request.headers.authorization });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "shipped", eta: "2026-10-06", internal: "hidden" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const workspace = await prisma.workspace.create({ data: { name: `M2 admin ${suffix}`, slug: `m2-admin-${suffix}`, supportEmail: `admin-${suffix}@example.com` } });
  workspaceId = workspace.id;
  agentId = (await prisma.aIAgent.create({ data: { workspaceId, name: "Support agent", provider: "Default", model: "groq/llama-3.3-70b-versatile", status: "ACTIVE" } })).id;
  otherWorkspaceId = (await prisma.workspace.create({ data: { name: `M2 other ${suffix}`, slug: `m2-other-${suffix}`, supportEmail: `other-${suffix}@example.com` } })).id;
  await prisma.workspaceSetting.create({ data: { workspaceId, timezone: "Asia/Karachi" } });
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId].filter(Boolean) } } });
  server.close();
  await prisma.$disconnect();
});

describe("tools API", () => {
  let toolId = "";

  it("requires a signed-in Manager to list tools, and seeds the built-ins", async () => {
    signedIn.current = null;
    expect((await tools.GET()).status).toBe(401);

    as("AGENT");
    expect((await tools.GET()).status).toBe(403);

    as("MANAGER");
    const response = await tools.GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.tools.filter((tool: { type: string }) => tool.type === "BUILT_IN")).toHaveLength(8);
    expect(body.canManageHttp).toBe(false);
    expect(body.templates.map((template: { id: string }) => template.id)).toEqual(["order_tracking", "invoice", "crm_lookup"]);
  });

  it("only lets Admins create HTTP tools, and validates them", async () => {
    as("MANAGER");
    expect((await tools.POST(json(trackOrder()))).status).toBe(403);

    as("ADMIN");
    const builtInName = await tools.POST(json({ ...trackOrder(), name: "create_ticket" }));
    expect(builtInName.status).toBe(400);
    expect((await builtInName.json()).error).toMatch(/built-in/);

    const hostPlaceholder = await tools.POST(json({ ...trackOrder(), httpUrl: "https://{order_number}.example.com/x" }));
    expect(hostPlaceholder.status).toBe(400);

    const badBody = await tools.POST(json({ ...trackOrder(), httpMethod: "POST", httpUrl: `${baseUrl}/orders`, httpBody: '{"order": "{missing}"}' }));
    expect((await badBody.json()).error).toMatch(/\{missing\}/);

    const created = await tools.POST(json({ ...trackOrder(), agentIds: [agentId] }));
    const body = await created.json();
    expect(created.status).toBe(201);
    toolId = body.tool.id;
    expect(body.tool.key).toBe("track_order");
    expect(body.tool.requiresConfirmation).toBe(false);
    expect(body.tool.agentIds).toEqual([agentId]);
    // Secrets never come back in clear text.
    expect(JSON.stringify(body)).not.toContain("s3cret-token-9876");
    expect(body.tool.httpHeaders[0].value).toBe("••••9876");
    expect(body.tool.httpHeaders[1].value).toBe("main");

    const stored = await prisma.agentTool.findUniqueOrThrow({ where: { id: toolId } });
    expect(decryptSecret(parseToolHeaders(stored.httpHeaders)[0].value)).toBe("Bearer s3cret-token-9876");

    expect((await tools.POST(json(trackOrder()))).status).toBe(409);
  });

  it("keeps the stored secret when an edit sends the masked value back", async () => {
    as("ADMIN");
    const response = await toolById.PATCH(
      json({ description: "Track where a customer's order is right now.", httpHeaders: [{ name: "Authorization", value: "••••9876", secret: true }] }, "PATCH"),
      params(toolId),
    );
    expect(response.status).toBe(200);
    const stored = await prisma.agentTool.findUniqueOrThrow({ where: { id: toolId } });
    expect(decryptSecret(parseToolHeaders(stored.httpHeaders)[0].value)).toBe("Bearer s3cret-token-9876");
    expect(stored.description).toBe("Track where a customer's order is right now.");
  });

  it("lets Managers toggle but not reconfigure HTTP tools", async () => {
    as("MANAGER");
    expect((await toolById.PATCH(json({ httpUrl: "https://evil.example.com/{order_number}" }, "PATCH"), params(toolId))).status).toBe(403);
    const toggled = await toolById.PATCH(json({ isEnabled: false }, "PATCH"), params(toolId));
    expect((await toggled.json()).tool.isEnabled).toBe(false);
    await toolById.PATCH(json({ isEnabled: true }, "PATCH"), params(toolId));
  });

  it("tests an HTTP tool against the API (Admin) and records the result", async () => {
    as("MANAGER");
    expect((await toolTest.POST(json({ input: { order_number: "1042" } }), params(toolId))).status).toBe(403);

    as("ADMIN");
    const response = await toolTest.POST(json({ input: { order_number: "1042" } }), params(toolId));
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.output).toEqual({ status: "shipped", eta: "2026-10-06" });
    expect(body.tool.lastTestStatus).toBe("OK");
    expect(received.at(-1)).toEqual({ url: "/orders/1042", auth: "Bearer s3cret-token-9876" });

    const missing = await toolTest.POST(json({ input: {} }), params(toolId));
    expect((await missing.json()).ok).toBe(false);
  });

  it("tests built-in writes as a simulation (Manager)", async () => {
    as("MANAGER");
    const createTicket = await prisma.agentTool.findFirstOrThrow({ where: { workspaceId, key: "create_ticket" } });
    const response = await toolTest.POST(json({ input: { subject: "Broken kettle", description: "It stopped heating." } }), params(createTicket.id));
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.output.simulated).toBe(true);
    expect(await prisma.ticket.count({ where: { workspaceId } })).toBe(0);
  });

  it("edits built-in actions with role checks", async () => {
    const book = await prisma.agentTool.findFirstOrThrow({ where: { workspaceId, key: "book_appointment" } });
    const lookup = await prisma.agentTool.findFirstOrThrow({ where: { workspaceId, key: "lookup_ticket_status" } });

    as("MANAGER");
    expect((await toolById.PATCH(json({ requiresConfirmation: false }, "PATCH"), params(book.id))).status).toBe(403);
    expect((await toolById.PATCH(json({ description: "short" }, "PATCH"), params(book.id))).status).toBe(400);
    const reworded = await toolById.PATCH(json({ description: "Book a consultation call with our sales team." }, "PATCH"), params(book.id));
    expect((await reworded.json()).tool.description).toBe("Book a consultation call with our sales team.");
    const reset = await toolById.PATCH(json({ description: "" }, "PATCH"), params(book.id));
    const resetBody = await reset.json();
    expect(resetBody.tool.description).toBe(resetBody.tool.defaultDescription);

    as("ADMIN");
    expect((await toolById.PATCH(json({ requiresConfirmation: true }, "PATCH"), params(lookup.id))).status).toBe(400);
    expect((await toolById.DELETE(new Request("http://localhost"), params(book.id))).status).toBe(400);
  });

  it("never touches another workspace's tools", async () => {
    const foreign = await prisma.agentTool.create({ data: { workspaceId: otherWorkspaceId, key: "foreign_tool", name: "Foreign", description: "Belongs to another workspace.", type: "HTTP", parameters: [], httpMethod: "GET", httpUrl: "https://example.com" } });
    as("ADMIN");
    expect((await toolById.PATCH(json({ isEnabled: false }, "PATCH"), params(foreign.id))).status).toBe(404);
    expect((await toolTest.POST(json({}), params(foreign.id))).status).toBe(404);
    expect((await toolById.DELETE(new Request("http://localhost"), params(foreign.id))).status).toBe(404);
  });
});

describe("agent tool settings API", () => {
  it("binds tools, validates intent rules and steps", async () => {
    as("AGENT");
    expect((await agentTools.GET(new Request("http://localhost"), params(agentId))).status).toBe(403);

    as("MANAGER");
    const initial = await (await agentTools.GET(new Request("http://localhost"), params(agentId))).json();
    expect(initial.agent.toolsEnabled).toBe(false);
    const track = initial.tools.find((tool: { key: string }) => tool.key === "track_order");
    const lookup = initial.tools.find((tool: { key: string }) => tool.key === "lookup_ticket_status");
    expect(track.bound).toBe(true);

    expect((await agentTools.PUT(json({ toolsEnabled: true, toolIds: [] }, "PUT"), params(agentId))).status).toBe(400);
    expect((await agentTools.PUT(json({ maxToolSteps: 12 }, "PUT"), params(agentId))).status).toBe(400);
    expect((await agentTools.PUT(json({ toolIds: ["not-a-tool"] }, "PUT"), params(agentId))).status).toBe(400);

    const ruleForUnbound = await agentTools.PUT(
      json({ toolsEnabled: true, toolIds: [track.id], intentRules: [{ phrases: ["ticket status"], toolKey: "lookup_ticket_status", mode: "ALWAYS" }] }, "PUT"),
      params(agentId),
    );
    expect(ruleForUnbound.status).toBe(400);

    const saved = await agentTools.PUT(
      json(
        {
          toolsEnabled: true,
          toolIds: [track.id, lookup.id],
          maxToolSteps: 5,
          escalateOnToolFailure: false,
          intentRules: [{ phrases: ["Where is my order?", "track order"], toolKey: "track_order", mode: "ALWAYS" }],
        },
        "PUT",
      ),
      params(agentId),
    );
    const body = await saved.json();
    expect(saved.status).toBe(200);
    expect(body.agent).toMatchObject({ toolsEnabled: true, maxToolSteps: 5, escalateOnToolFailure: false });
    expect(body.agent.intentRules[0].phrases).toEqual(["where is my order", "track order"]);
    expect(body.tools.filter((tool: { bound: boolean }) => tool.bound).map((tool: { key: string }) => tool.key).sort()).toEqual(["lookup_ticket_status", "track_order"]);

    // Unbinding a tool drops the rules that pointed at it.
    const unbound = await (await agentTools.PUT(json({ toolIds: [lookup.id] }, "PUT"), params(agentId))).json();
    expect(unbound.agent.intentRules).toEqual([]);
  });
});

describe("appointments API", () => {
  it("validates business hours (Admin only)", async () => {
    as("MANAGER");
    expect((await appointmentSettings.PUT(json({}, "PUT"))).status).toBe(403);

    as("ADMIN");
    expect((await appointmentSettings.PUT(json({ slotMinutes: 25, daysAhead: 14, days: [1], start: "09:00", end: "17:00" }, "PUT"))).status).toBe(400);
    expect((await appointmentSettings.PUT(json({ slotMinutes: 60, daysAhead: 14, days: [1], start: "09:00", end: "09:30" }, "PUT"))).status).toBe(400);
    const saved = await appointmentSettings.PUT(json({ slotMinutes: 60, daysAhead: 30, days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:00" }, "PUT"));
    expect((await saved.json()).settings).toMatchObject({ slotMinutes: 60, daysAhead: 30, hours: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:00" } });
  });

  it("books, lists, completes and cancels appointments", async () => {
    as("AGENT");
    const slots = await (await appointmentSlots.GET(new Request("http://localhost/api/appointments/slots"))).json();
    expect(slots.slots.length).toBeGreaterThan(0);
    const startsAt = slots.slots[0].startsAt;

    expect((await appointments.POST(json({ startsAt, name: "Ayesha" }))).status).toBe(400);
    expect((await appointments.POST(json({ startsAt, name: "Ayesha", email: "not-an-email" }))).status).toBe(400);
    const booked = await appointments.POST(json({ startsAt, name: "Ayesha Khan", email: "Ayesha@Example.com", topic: "Kettle demo" }));
    const bookedBody = await booked.json();
    expect(booked.status).toBe(201);
    expect(bookedBody.appointment).toMatchObject({ name: "Ayesha Khan", email: "ayesha@example.com", createdBy: "TEAM", status: "BOOKED" });

    const taken = await appointments.POST(json({ startsAt, name: "Bilal", phone: "03001234567" }));
    expect(taken.status).toBe(409);

    const list = await (await appointments.GET(new Request("http://localhost/api/appointments?view=upcoming"))).json();
    expect(list.total).toBe(1);
    expect(list.upcomingCount).toBe(1);
    expect(list.canEditSettings).toBe(false);
    expect(list.nextFreeSlots.map((slot: { startsAt: string }) => slot.startsAt)).not.toContain(startsAt);

    const id = bookedBody.appointment.id;
    expect((await appointmentById.PATCH(json({ status: "BOOKED_TWICE" }, "PATCH"), params(id))).status).toBe(400);
    expect((await appointmentById.PATCH(json({ status: "COMPLETED", notes: "Went well" }, "PATCH"), params(id))).status).toBe(200);
    expect((await appointmentById.PATCH(json({ status: "CANCELLED" }, "PATCH"), params(id))).status).toBe(400);
    expect((await appointmentById.PATCH(json({ status: "BOOKED" }, "PATCH"), params(id))).status).toBe(200);
    expect((await appointmentById.PATCH(json({ status: "CANCELLED" }, "PATCH"), params(id))).status).toBe(200);
    expect((await appointmentById.PATCH(json({ status: "BOOKED" }, "PATCH"), params(id))).status).toBe(400);

    const cancelled = await (await appointments.GET(new Request("http://localhost/api/appointments?view=cancelled&q=kettle"))).json();
    expect(cancelled.appointments.map((row: { id: string; notes: string }) => [row.id, row.notes])).toEqual([[id, "Went well"]]);
  });
});
