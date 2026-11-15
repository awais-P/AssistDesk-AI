import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Module 11 FE-1: the HubSpot (CRM) and Shopify (e-commerce) connectors. HubSpot and
 * Shopify are replaced by an in-memory fake behind `fetch` (they can't be reached from a
 * test); the routes, the database, the encryption, the lead sync and the AI action are real.
 */

type SignedIn = { user: { id: string; role: string; workspaceId: string; fullName: string; customRole?: null } };
const signedIn: { current: SignedIn | null } = { current: null };

vi.mock("@/src/lib/auth", async (original) => ({
  ...(await original<typeof import("@/src/lib/auth")>()),
  getCurrentSession: async () => signedIn.current,
}));

// Plainly fake test values (the fake vendor below accepts exactly these).
const GOOD_HUBSPOT = "fake-hubspot-token-for-tests";
const GOOD_SHOPIFY = "fake-shopify-token-for-tests";
const fake = {
  hubspotContacts: new Map<string, { id: string; properties: Record<string, string> }>(),
  calls: [] as string[],
  revoked: false,
};
const orders = [
  {
    name: "#1042",
    email: "ali.raza@example.com",
    phone: "+923001112233",
    created_at: "2026-11-10T09:00:00Z",
    cancelled_at: null,
    financial_status: "paid",
    fulfillment_status: "fulfilled",
    total_price: "4500.00",
    currency: "PKR",
    line_items: [{ title: "Steel kettle", quantity: 1 }],
    fulfillments: [{ status: "success", tracking_company: "TCS", tracking_number: "TCS123", tracking_url: "https://tcs.example/TCS123", updated_at: "2026-11-11T09:00:00Z" }],
    customer: { email: "ali.raza@example.com", phone: "+923001112233" },
  },
];

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const headers = new Headers(init?.headers);
  fake.calls.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);

  if (url.host === "api.hubapi.com") {
    if (fake.revoked || headers.get("authorization") !== `Bearer ${GOOD_HUBSPOT}`) return reply(401, { message: "Authentication credentials not found." });
    if (url.pathname === "/crm/v3/objects/contacts" && (init?.method ?? "GET") === "GET") return reply(200, { results: [] });
    if (url.pathname === "/crm/v3/objects/contacts/search") {
      const value = JSON.parse(String(init?.body)).filterGroups[0].filters[0].value;
      const found = [...fake.hubspotContacts.values()].find((contact) => contact.properties.email === value || contact.properties.phone === value);
      return reply(200, { results: found ? [{ id: found.id }] : [] });
    }
    if (url.pathname === "/crm/v3/objects/contacts" && init?.method === "POST") {
      const id = String(1000 + fake.hubspotContacts.size);
      fake.hubspotContacts.set(id, { id, properties: JSON.parse(String(init.body)).properties });
      return reply(201, { id });
    }
    const patch = /^\/crm\/v3\/objects\/contacts\/(\w+)$/.exec(url.pathname);
    if (patch && init?.method === "PATCH") {
      const contact = fake.hubspotContacts.get(patch[1]);
      if (!contact) return reply(404, {});
      Object.assign(contact.properties, JSON.parse(String(init.body)).properties);
      return reply(200, { id: contact.id });
    }
  }

  if (url.host === "kettle-store.myshopify.com") {
    if (headers.get("x-shopify-access-token") !== GOOD_SHOPIFY) return reply(401, { errors: "Invalid API key or access token" });
    if (url.pathname.endsWith("/shop.json")) return reply(200, { shop: { name: "Kettle Store" } });
    if (url.pathname.endsWith("/orders.json")) {
      const name = url.searchParams.get("name");
      return reply(200, { orders: orders.filter((order) => order.name === name) });
    }
  }

  return reply(404, { error: "unexpected call in test" });
});
vi.stubGlobal("fetch", fakeFetch);

const connectors = await import("@/app/api/connectors/route");
const connector = await import("@/app/api/connectors/[provider]/route");
const { captureLead, updateLead } = await import("@/src/lib/leads");
const { syncLeadToCrm } = await import("@/src/lib/connectors");
const { loadAgentToolset, runTool, toRuntimeTool } = await import("@/src/lib/tools/registry");

const suffix = Date.now().toString(36);
let workspaceId = "";
let adminId = "";
let agentId = "";

const asRole = (role: string) => (signedIn.current = { user: { id: adminId, role, workspaceId, fullName: "Amna Admin" } });
const post = (body: unknown) => new Request("http://localhost/api/connectors", { method: "POST", body: JSON.stringify(body) });
const provider = (name: string) => ({ params: Promise.resolve({ provider: name }) });
const waitFor = async (check: () => Promise<boolean>) => {
  for (let index = 0; index < 50; index += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out");
};

beforeAll(async () => {
  workspaceId = (await prisma.workspace.create({ data: { name: `Connectors ${suffix}`, slug: `connectors-${suffix}` } })).id;
  adminId = (await prisma.user.create({ data: { workspaceId, fullName: "Amna Admin", username: `conn-${suffix}`, email: `conn-${suffix}@example.com`, role: "ADMIN" } })).id;
  agentId = (await prisma.aIAgent.create({ data: { workspaceId, name: "Store agent", provider: "Default", model: "groq/llama-3.3-70b-versatile", status: "ACTIVE", toolsEnabled: true } })).id;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.$disconnect();
});

describe("IT-24 CRM and e-commerce connectors - Module 11 FE-1", () => {
  it("IT-24.01 only admins connect; a wrong HubSpot token is refused and nothing is saved", async () => {
    asRole("MANAGER");
    expect((await connectors.POST(post({ provider: "HUBSPOT", token: GOOD_HUBSPOT }))).status).toBe(403);

    asRole("ADMIN");
    const refused = await connectors.POST(post({ provider: "HUBSPOT", token: "fake-wrong-token-for-tests" }));
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/token was refused/);
    expect(await prisma.connector.count({ where: { workspaceId } })).toBe(0);
  });

  it("IT-24.02 HubSpot connects after a live check; the token is stored encrypted and never returned", async () => {
    const response = await connectors.POST(post({ provider: "HUBSPOT", token: GOOD_HUBSPOT }));
    expect(response.status).toBe(200);
    const row = await prisma.connector.findFirstOrThrow({ where: { workspaceId, provider: "HUBSPOT" } });
    expect(row.secret).not.toContain(GOOD_HUBSPOT);
    expect(JSON.stringify(await (await connectors.GET(new Request("http://localhost/api/connectors"))).json())).not.toContain(GOOD_HUBSPOT);
    expect(await prisma.auditLog.count({ where: { workspaceId, action: "connector.connected" } })).toBe(1);
  });

  it("IT-24.03 a new lead is sent to HubSpot automatically and keeps the HubSpot id", async () => {
    const { lead } = await captureLead({ workspaceId, channel: "WEB_WIDGET", source: "MANUAL", values: { name: "Hina Shah", email: "hina@example.com", phone: null, company: "Pearl Bakers", fields: [] } });
    await waitFor(async () => Boolean((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).crmId));

    const saved = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(fake.hubspotContacts.get(saved.crmId!)?.properties).toMatchObject({ email: "hina@example.com", firstname: "Hina", lastname: "Shah", company: "Pearl Bakers", lifecyclestage: "lead", hs_lead_status: "NEW" });
    expect(saved.crmSyncedAt?.getTime()).toBe(saved.updatedAt.getTime());
  });

  it("IT-24.04 a status change updates the same HubSpot contact", async () => {
    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId, email: "hina@example.com" } });
    await updateLead(workspaceId, lead.id, { status: "QUALIFIED" }, "Amna Admin");
    await waitFor(async () => fake.hubspotContacts.get(lead.crmId!)?.properties.hs_lead_status === "OPEN_DEAL");
    expect(fake.hubspotContacts.size).toBe(1);
  });

  it("IT-24.05 Sync now sends leads that are missing or changed, and skips the rest", async () => {
    await connector.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ action: "settings", autoSync: false }) }), provider("hubspot"));
    await captureLead({ workspaceId, channel: "WHATSAPP", source: "AUTO", values: { name: "Usman Tariq", email: null, phone: "+923004445566", company: null, fields: [] } });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await prisma.lead.count({ where: { workspaceId, crmId: null } })).toBe(1);

    const first = await (await connector.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ action: "sync" }) }), provider("hubspot"))).json();
    expect(first.synced).toBe(1);
    const second = await (await connector.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ action: "sync" }) }), provider("hubspot"))).json();
    expect(second.synced).toBe(0);
  });

  it("IT-24.06 a revoked HubSpot token marks the connector for attention and alerts the team", async () => {
    fake.revoked = true;
    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId, email: "hina@example.com" } });
    await expect(syncLeadToCrm(lead.id)).rejects.toThrow(/refused/);
    expect((await prisma.connector.findFirstOrThrow({ where: { workspaceId, provider: "HUBSPOT" } })).status).toBe("ERROR");
    expect(await prisma.notification.count({ where: { workspaceId, type: "INTEGRATION_ERROR" } })).toBe(1);
    fake.revoked = false;
  });

  it("IT-24.07 Shopify accepts only a *.myshopify.com store, so no other host can be reached", async () => {
    const before = fake.calls.length;
    for (const shopDomain of ["evil.example.com", "localhost:3000", "kettle-store.myshopify.com.evil.com", "169.254.169.254"]) {
      expect((await connectors.POST(post({ provider: "SHOPIFY", shopDomain, token: GOOD_SHOPIFY }))).status).toBe(400);
    }
    expect(fake.calls.length).toBe(before);
  });

  it("IT-24.08 connecting Shopify turns the order action on for the agents", async () => {
    let toolset = await loadAgentToolset(workspaceId, agentId);
    expect(toolset.tools.map((tool) => tool.key)).not.toContain("shopify_order_status");

    expect((await connectors.POST(post({ provider: "SHOPIFY", shopDomain: "https://Kettle-Store.myshopify.com/admin", token: GOOD_SHOPIFY }))).status).toBe(200);
    toolset = await loadAgentToolset(workspaceId, agentId);
    expect(toolset.tools.map((tool) => tool.key)).toContain("shopify_order_status");
  });

  it("IT-24.09 the AI shows an order only to the customer it belongs to", async () => {
    const row = await prisma.agentTool.findFirstOrThrow({ where: { workspaceId, builtInKey: "shopify_order_status" } });
    const tool = toRuntimeTool(row)!;
    const ctx = (email: string | null) => ({
      workspaceId,
      agentId,
      runId: null,
      step: 1,
      sessionId: null,
      ticketId: null,
      contactId: null,
      channel: "WEB_WIDGET" as const,
      verifiedIdentity: true,
      customer: { name: "Ali Raza", email, phone: null },
      timeZone: "Asia/Karachi",
      dryRun: false,
      triggeredBy: "MODEL" as const,
    });

    const mine = await runTool({ tool, rawInput: { order_number: "#1042" }, ctx: ctx("ali.raza@example.com") });
    expect(mine.output).toMatchObject({ found: true, order: "#1042", status: "shipped", payment: "paid", tracking: [{ carrier: "TCS", number: "TCS123" }] });

    const someoneElse = await runTool({ tool, rawInput: { order_number: "1042", email: "intruder@example.com" }, ctx: ctx(null) });
    expect(someoneElse.output).toMatchObject({ found: false });
    expect(JSON.stringify(someoneElse.output)).not.toContain("Steel kettle");

    const unknownCustomer = await runTool({ tool, rawInput: { order_number: "1042" }, ctx: ctx(null) });
    expect((unknownCustomer.output as { note: string }).note).toMatch(/email or phone/);
  });

  it("IT-24.10 disconnecting deletes the token and hides the action again", async () => {
    expect((await connector.DELETE(new Request("http://localhost", { method: "DELETE" }), provider("shopify"))).status).toBe(200);
    expect((await prisma.connector.findFirstOrThrow({ where: { workspaceId, provider: "SHOPIFY" } })).secret).toBeNull();
    expect((await loadAgentToolset(workspaceId, agentId)).tools.map((tool) => tool.key)).not.toContain("shopify_order_status");
  });
});
