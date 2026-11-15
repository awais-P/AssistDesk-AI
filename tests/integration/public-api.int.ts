import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Module 11 FE-2: API keys (created once, hashed, scoped, revocable, expiring, rate
 * limited) and the public REST API under /api/v1, called as route handlers with real
 * keys against a real database.
 */

process.env.ASSISTDESK_ESCALATION_SUMMARY = "off";

type SignedIn = { user: { id: string; role: string; workspaceId: string; fullName: string; customRole?: null } };
const signedIn: { current: SignedIn | null } = { current: null };

vi.mock("@/src/lib/auth", async (original) => ({
  ...(await original<typeof import("@/src/lib/auth")>()),
  getCurrentSession: async () => signedIn.current,
}));

const keysRoute = await import("@/app/api/api-keys/route");
const keyById = await import("@/app/api/api-keys/[id]/route");
const v1 = await import("@/app/api/v1/route");
const v1Tickets = await import("@/app/api/v1/tickets/route");
const v1Ticket = await import("@/app/api/v1/tickets/[id]/route");
const v1Contacts = await import("@/app/api/v1/contacts/route");
const v1Leads = await import("@/app/api/v1/leads/route");
const v1Conversations = await import("@/app/api/v1/conversations/route");
const v1Conversation = await import("@/app/api/v1/conversations/[id]/route");
const v1Escalations = await import("@/app/api/v1/escalations/route");
const v1Spec = await import("@/app/api/v1/openapi.json/route");

const suffix = Date.now().toString(36);
let workspaceId = "";
let otherWorkspaceId = "";
let adminId = "";
let fullKey = "";
let fullKeyId = "";
let readOnlyKey = "";

const asAdmin = () => (signedIn.current = { user: { id: adminId, role: "ADMIN", workspaceId, fullName: "Amna Admin" } });
const asManager = () => (signedIn.current = { user: { id: adminId, role: "MANAGER", workspaceId, fullName: "Amna Admin" } });

function call(path: string, key: string | null, init: { method?: string; body?: unknown } = {}) {
  return new Request(`http://localhost/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json", "x-forwarded-for": "198.51.100.20" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function createKey(name: string, scopes: string[], expiresInDays?: number) {
  asAdmin();
  const response = await keysRoute.POST(new Request("http://localhost/api/api-keys", { method: "POST", body: JSON.stringify({ name, scopes, expiresInDays }) }));
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  workspaceId = (await prisma.workspace.create({ data: { name: `API ${suffix}`, slug: `api-${suffix}` } })).id;
  otherWorkspaceId = (await prisma.workspace.create({ data: { name: `API other ${suffix}`, slug: `api-other-${suffix}` } })).id;
  adminId = (await prisma.user.create({ data: { workspaceId, fullName: "Amna Admin", username: `api-admin-${suffix}`, email: `api-admin-${suffix}@example.com`, role: "ADMIN" } })).id;
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
  await prisma.$disconnect();
});

describe("IT-23 API keys and the public REST API - Module 11 FE-2", () => {
  it("IT-23.01 an admin creates a key; it is shown once and only its hash is stored", async () => {
    const created = await createKey("Store back-end", ["tickets:read", "tickets:write", "contacts:read", "contacts:write", "leads:read", "leads:write", "conversations:read", "escalations:read"]);
    expect(created.status).toBe(201);
    fullKey = created.body.secret;
    fullKeyId = created.body.key.id;
    expect(fullKey).toMatch(/^ad_live_/);

    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: fullKeyId } });
    expect(stored.keyHash).not.toBe(fullKey);
    expect(fullKey.startsWith(stored.prefix)).toBe(true);
    const listed = await (await keysRoute.GET(new Request("http://localhost/api/api-keys"))).json();
    expect(JSON.stringify(listed)).not.toContain(fullKey);
    expect(await prisma.auditLog.count({ where: { workspaceId, action: "api_key.created" } })).toBe(1);

    readOnlyKey = (await createKey("Reporting", ["tickets:read"])).body.secret;
    asManager();
    expect((await keysRoute.GET(new Request("http://localhost/api/api-keys"))).status).toBe(403);
  });

  it("IT-23.02 calls without a valid key are refused; a valid key sees its workspace and is counted", async () => {
    expect((await v1.GET(call("/", null))).status).toBe(401);
    expect((await v1.GET(call("/", "ad_live_not-a-real-key"))).status).toBe(401);

    const response = await v1.GET(call("/", fullKey));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workspace: { id: workspaceId }, key: { name: "Store back-end" } });
    expect(response.headers.get("x-ratelimit-limit") ?? response.headers.get("ratelimit-limit")).toBeTruthy();
    const usage = await prisma.apiKey.findUniqueOrThrow({ where: { id: fullKeyId } });
    expect(usage.usageCount).toBe(1);
    expect(usage.lastUsedAt).toBeInstanceOf(Date);
  });

  it("IT-23.03 a key without the needed permission is refused and the attempt is logged", async () => {
    const response = await v1Tickets.POST(call("/tickets", readOnlyKey, { method: "POST", body: { subject: "x", message: "y" } }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("missing_scope");
    expect(await prisma.auditLog.findFirst({ where: { workspaceId, action: "access.denied", actorType: "API_KEY" } })).toMatchObject({ outcome: "DENIED" });
  });

  it("IT-23.04 creates a ticket through the API, with the customer linked and the write audited", async () => {
    expect((await v1Tickets.POST(call("/tickets", fullKey, { method: "POST", body: { subject: "No message" } }))).status).toBe(400);
    const response = await v1Tickets.POST(
      call("/tickets", fullKey, { method: "POST", body: { subject: "Order 1042 arrived damaged", message: "The kettle lid is cracked.", requester_email: "Ali.Raza@Example.com", requester_name: "Ali Raza", priority: "HIGH" } }),
    );
    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data).toMatchObject({ subject: "Order 1042 arrived damaged", requesterEmail: "ali.raza@example.com", priority: "HIGH", status: "OPEN" });
    expect(data.contactId).toBeTruthy();
    expect(data.messages[0].content).toBe("The kettle lid is cracked.");

    await prisma.ticketMessage.create({ data: { workspaceId, ticketId: data.id, sender: "SYSTEM", content: "[[INTERNAL_NOTE]]\nVIP customer" } });
    const fetched = await (await v1Ticket.GET(call(`/tickets/${data.id}`, fullKey), params(data.id))).json();
    expect(fetched.data.messages.map((message: { content: string }) => message.content).join(" ")).not.toContain("VIP customer");

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId, action: "api.ticket_created" } });
    expect(audit).toMatchObject({ actorType: "API_KEY", actorId: fullKeyId, targetId: data.id });
    expect(audit.actorName).toBe('API key "Store back-end"');
  });

  it("IT-23.05 lists tickets with filters and pages through them with a cursor", async () => {
    await v1Tickets.POST(call("/tickets", fullKey, { method: "POST", body: { subject: "Second", message: "Hello" } }));
    await v1Tickets.POST(call("/tickets", fullKey, { method: "POST", body: { subject: "Third", message: "Hello" } }));
    const first = await (await v1Tickets.GET(call("/tickets?limit=2", readOnlyKey))).json();
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await (await v1Tickets.GET(call(`/tickets?limit=2&cursor=${first.nextCursor}`, readOnlyKey))).json();
    expect(second.data).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect((await (await v1Tickets.GET(call("/tickets?requester_email=ali.raza@example.com", readOnlyKey))).json()).data).toHaveLength(1);
    expect((await v1Tickets.GET(call("/tickets?status=SOMETHING", readOnlyKey))).status).toBe(400);
  });

  it("IT-23.06 creates and finds customers and leads", async () => {
    const contact = await v1Contacts.POST(call("/contacts", fullKey, { method: "POST", body: { email: "hina@example.com", name: "Hina Shah" } }));
    expect(contact.status).toBe(201);
    expect((await (await v1Contacts.GET(call("/contacts?email=hina@example.com", fullKey))).json()).data[0]).toMatchObject({ name: "Hina Shah" });

    const lead = await v1Leads.POST(call("/leads", fullKey, { method: "POST", body: { email: "hina@example.com", name: "Hina Shah", company: "Pearl Bakers", interest: "50 kettles for a cafe" } }));
    expect(lead.status).toBe(201);
    expect((await lead.json()).data).toMatchObject({ source: "API", company: "Pearl Bakers" });
    expect((await (await v1Leads.GET(call("/leads", fullKey))).json()).data).toHaveLength(1);
    expect((await v1Leads.POST(call("/leads", fullKey, { method: "POST", body: { name: "No contact" } }))).status).toBe(400);
  });

  it("IT-23.07 reads conversations with their transcript and escalations", async () => {
    const session = await prisma.chatSession.create({ data: { workspaceId, channel: "WHATSAPP", customerName: "Kamran", status: "ESCALATED" } });
    await prisma.chatMessage.create({ data: { sessionId: session.id, sender: "USER", content: "I want a person" } });
    await prisma.escalation.create({ data: { workspaceId, sessionId: session.id, channel: "WHATSAPP", trigger: "HUMAN_REQUEST", reason: "Asked for a person" } });

    expect((await (await v1Conversations.GET(call("/conversations?channel=WHATSAPP", fullKey))).json()).data[0]).toMatchObject({ id: session.id, status: "ESCALATED" });
    const detail = await (await v1Conversation.GET(call(`/conversations/${session.id}`, fullKey), params(session.id))).json();
    expect(detail.data.messages[0].content).toBe("I want a person");
    const escalations = await (await v1Escalations.GET(call("/escalations?status=PENDING", fullKey))).json();
    expect(escalations.data[0]).toMatchObject({ trigger: "HUMAN_REQUEST", conversationId: session.id });
  });

  it("IT-23.08 a key only ever sees its own workspace", async () => {
    const foreign = await prisma.chatSession.create({ data: { workspaceId: otherWorkspaceId, channel: "WEB_WIDGET" } });
    expect((await v1Conversation.GET(call(`/conversations/${foreign.id}`, fullKey), params(foreign.id))).status).toBe(404);
  });

  it("IT-23.09 revoked and expired keys stop working at once", async () => {
    const temporary = await createKey("Temporary", ["tickets:read"], 1);
    expect((await v1.GET(call("/", temporary.body.secret))).status).toBe(200);
    await prisma.apiKey.update({ where: { id: temporary.body.key.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await (await v1.GET(call("/", temporary.body.secret))).json()).error.code).toBe("key_expired");

    asAdmin();
    expect((await keyById.DELETE(new Request("http://localhost", { method: "DELETE" }), params(fullKeyId))).status).toBe(200);
    expect((await v1.GET(call("/", fullKey))).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { workspaceId, action: "api_key.revoked" } })).toBe(1);
  });

  it("IT-23.10 each key is rate limited", async () => {
    let last = 0;
    for (let index = 0; index < 125 && last !== 429; index += 1) {
      last = (await v1.GET(call("/", readOnlyKey))).status;
    }
    expect(last).toBe(429);
  });

  it("IT-23.11 the API description is public", async () => {
    const spec = await (await v1Spec.GET()).json();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/tickets"].post.summary).toContain("tickets:write");
  });
});
