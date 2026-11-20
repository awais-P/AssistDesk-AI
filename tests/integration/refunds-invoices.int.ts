import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Module 2 FE-1: refunds approved by the team, and invoice links. Shopify is replaced by
 * an in-memory fake behind `fetch`, and email by a recorder; the AI actions, the routes,
 * the permission checks, the conversation messages and the database are real.
 */

type SignedIn = { user: { id: string; role: string; workspaceId: string; fullName: string; customRole?: null } };
const signedIn: { current: SignedIn | null } = { current: null };

vi.mock("@/src/lib/auth", async (original) => ({
  ...(await original<typeof import("@/src/lib/auth")>()),
  getCurrentSession: async () => signedIn.current,
}));

const emails: Array<{ to: string[]; subject: string; text: string }> = [];
vi.mock("@/src/lib/mailer", async (original) => ({
  ...(await original<typeof import("@/src/lib/mailer")>()),
  sendTeamEmail: async (message: { to: string[]; subject: string; text: string }) => {
    emails.push(message);
    return { status: "SENT", error: null };
  },
}));

// Plainly fake test value (the fake store below accepts exactly this).
const GOOD_SHOPIFY = "fake-shopify-token-for-tests";
const DAY = 24 * 60 * 60 * 1000;
const shop = { calls: [] as string[], refundable: new Set(["5001"]), scopeMissing: false };
const order = (id: number, name: string, daysAgo: number, email: string) => ({
  id,
  name,
  email,
  phone: null,
  created_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
  cancelled_at: null,
  financial_status: "paid",
  fulfillment_status: "fulfilled",
  currency: "PKR",
  subtotal_price: "3846.15",
  total_tax: "653.85",
  total_price: "4500.00",
  line_items: [{ id: id * 10, title: "Steel kettle", quantity: 1, price: "3846.15" }],
  customer: { first_name: "Sara", last_name: "Iqbal", email, phone: null },
});
const orders = [order(5001, "#2001", 5, "sara@example.com"), order(5002, "#2002", 60, "sara@example.com"), order(5003, "#2003", 3, "sara@example.com")];

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    shop.calls.push(`${method} ${url.pathname}`);

    if (url.host !== "kettle-store.myshopify.com" || new Headers(init?.headers).get("x-shopify-access-token") !== GOOD_SHOPIFY) {
      return reply(401, { errors: "Invalid API key or access token" });
    }

    if (url.pathname.endsWith("/shop.json")) return reply(200, { shop: { name: "Kettle Store" } });
    if (url.pathname.endsWith("/orders.json")) return reply(200, { orders: orders.filter((item) => item.name === url.searchParams.get("name")) });

    const refund = /\/orders\/(\d+)(\.json|\/refunds\/calculate\.json|\/refunds\.json)$/.exec(url.pathname);
    if (refund) {
      const [, id, kind] = refund;
      const found = orders.find((item) => String(item.id) === id);
      if (!found) return reply(404, {});
      if (kind === ".json") return reply(200, { order: { id: found.id, line_items: found.line_items } });
      if (shop.scopeMissing) return reply(403, { errors: "This action requires merchant approval for write_orders scope." });
      const transactions = shop.refundable.has(id) ? [{ parent_id: 777, amount: "4500.00", gateway: "shopify_payments" }] : [];
      if (kind === "/refunds/calculate.json") return reply(200, { refund: { transactions } });
      const body = JSON.parse(String(init?.body));
      expect(body.refund.transactions).toEqual([{ parent_id: 777, amount: "4500.00", kind: "refund", gateway: "shopify_payments" }]);
      shop.refundable.delete(id);
      return reply(201, { refund: { id: 9901 } });
    }

    return reply(404, { error: "unexpected call in test" });
  }),
);

const connectors = await import("@/app/api/connectors/route");
const refundsRoute = await import("@/app/api/refund-requests/route");
const refundRoute = await import("@/app/api/refund-requests/[id]/route");
const settingsRoute = await import("@/app/api/refund-requests/settings/route");
const { ensureBuiltInTools, runTool, toRuntimeTool } = await import("@/src/lib/tools/registry");
const { loadOrderInvoice } = await import("@/src/lib/order-invoices");

const suffix = Date.now().toString(36);
const ids = { store: "", plain: "", admin: "", manager: "", agent: "", openChat: "", closedChat: "", plainChat: "" };

const as = (role: "ADMIN" | "MANAGER" | "AGENT", workspaceId = ids.store) =>
  (signedIn.current = { user: { id: ids[role.toLowerCase() as "admin"], role, workspaceId, fullName: `${role[0]}${role.slice(1).toLowerCase()} User` } });

async function tool(workspaceId: string, key: string) {
  return toRuntimeTool(await prisma.agentTool.findFirstOrThrow({ where: { workspaceId, builtInKey: key } }))!;
}

const ctx = (workspaceId: string, sessionId: string | null, email: string | null, triggeredBy: "MODEL" | "CONFIRMATION" = "CONFIRMATION") => ({
  workspaceId,
  agentId: null,
  runId: null,
  step: 1,
  sessionId,
  ticketId: null,
  contactId: null,
  channel: "WEB_WIDGET" as const,
  verifiedIdentity: false,
  customer: { name: "Sara Iqbal", email, phone: null },
  timeZone: "Asia/Karachi",
  dryRun: false,
  triggeredBy,
});

const decide = (id: string, body: unknown) =>
  refundRoute.PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  ids.store = (await prisma.workspace.create({ data: { name: `Kettle Store ${suffix}`, slug: `refunds-${suffix}`, supportEmail: "help@kettle.example" } })).id;
  ids.plain = (await prisma.workspace.create({ data: { name: `No Store ${suffix}`, slug: `refunds-plain-${suffix}` } })).id;
  for (const role of ["ADMIN", "MANAGER", "AGENT"] as const) {
    const key = role.toLowerCase() as "admin";
    ids[key] = (await prisma.user.create({ data: { workspaceId: ids.store, fullName: `${role} User`, username: `ref-${key}-${suffix}`, email: `ref-${key}-${suffix}@example.com`, role } })).id;
  }
  ids.openChat = (await prisma.chatSession.create({ data: { workspaceId: ids.store, channel: "WEB_WIDGET", status: "ACTIVE" } })).id;
  ids.closedChat = (await prisma.chatSession.create({ data: { workspaceId: ids.store, channel: "WEB_WIDGET", status: "CLOSED" } })).id;
  ids.plainChat = (await prisma.chatSession.create({ data: { workspaceId: ids.plain, channel: "WEB_WIDGET", status: "ACTIVE" } })).id;
  await ensureBuiltInTools(ids.store);
  await ensureBuiltInTools(ids.plain);

  as("ADMIN");
  const connected = await connectors.POST(
    new Request("http://localhost/api/connectors", { method: "POST", body: JSON.stringify({ provider: "SHOPIFY", shopDomain: "kettle-store.myshopify.com", token: GOOD_SHOPIFY }) }),
  );
  expect(connected.status).toBe(200);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await prisma.workspace.deleteMany({ where: { id: { in: [ids.store, ids.plain] } } });
  await prisma.$disconnect();
});

describe("IT-34 refunds approved by the team, and invoice links - Module 2 FE-1", () => {
  it("IT-34.01 the AI asks the customer before requesting a refund; nothing is created until they agree", async () => {
    const result = await runTool({ tool: await tool(ids.store, "request_refund"), rawInput: { order_number: "#2001", reason: "Arrived dented" }, ctx: ctx(ids.store, ids.openChat, "sara@example.com", "MODEL") });
    expect(result.status).toBe("PENDING_CONFIRMATION");
    expect(await prisma.refundRequest.count({ where: { workspaceId: ids.store } })).toBe(0);
  });

  it("IT-34.02 once confirmed, the customer's own order becomes a pending request; the team is notified and a second request is refused", async () => {
    const refund = await tool(ids.store, "request_refund");
    const first = await runTool({ tool: refund, rawInput: { order_number: "#2001", reason: "Arrived dented" }, ctx: ctx(ids.store, ids.openChat, "sara@example.com") });
    expect(first.output).toMatchObject({ created: true, status: "PENDING", amount: 4500, currency: "PKR" });

    const saved = await prisma.refundRequest.findFirstOrThrow({ where: { workspaceId: ids.store } });
    expect(saved).toMatchObject({ orderNumber: "2001", source: "SHOPIFY", externalOrderId: "5001", amount: 4500, status: "PENDING", customerEmail: "sara@example.com", sessionId: ids.openChat });
    expect(await prisma.notification.count({ where: { workspaceId: ids.store, type: "REFUND_REQUEST" } })).toBe(1);
    expect(await prisma.sessionEvent.count({ where: { sessionId: ids.openChat, type: "REFUND_REQUESTED" } })).toBe(1);

    const again = await runTool({ tool: refund, rawInput: { order_number: "2001", reason: "Still dented" }, ctx: ctx(ids.store, ids.openChat, "sara@example.com") });
    expect(again.output).toMatchObject({ created: false, status: "PENDING" });
    expect(await prisma.refundRequest.count({ where: { workspaceId: ids.store } })).toBe(1);
  });

  it("IT-34.03 someone else's order, an unverified customer and an order outside the refund window are refused", async () => {
    const refund = await tool(ids.store, "request_refund");
    const stranger = await runTool({ tool: refund, rawInput: { order_number: "2003", reason: "x", email: "intruder@example.com" }, ctx: ctx(ids.store, ids.openChat, null) });
    expect(stranger.output).toMatchObject({ created: false });
    expect(JSON.stringify(stranger.output)).not.toContain("4500");

    const unknown = await runTool({ tool: refund, rawInput: { order_number: "2003", reason: "x" }, ctx: ctx(ids.store, ids.openChat, null) });
    expect((unknown.output as { note: string }).note).toMatch(/email or phone/);

    const old = await runTool({ tool: refund, rawInput: { order_number: "2002", reason: "Changed my mind" }, ctx: ctx(ids.store, ids.openChat, "sara@example.com") });
    expect(old.output).toMatchObject({ created: false, eligible: false });
    expect((old.output as { note: string }).note).toMatch(/more than 30 days/);
    expect(await prisma.refundRequest.count({ where: { workspaceId: ids.store } })).toBe(1);
  });

  it("IT-34.04 only admins change the refund window; a longer window lets the older order through", async () => {
    const put = (body: unknown) => settingsRoute.PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify(body) }));
    as("MANAGER");
    expect((await put({ refundWindowDays: 90 })).status).toBe(403);
    as("ADMIN");
    expect((await put({ refundWindowDays: 0 })).status).toBe(400);
    expect((await put({ refundWindowDays: 90 })).status).toBe(200);

    const old = await runTool({ tool: await tool(ids.store, "request_refund"), rawInput: { order_number: "2002", reason: "Changed my mind" }, ctx: ctx(ids.store, ids.closedChat, "sara@example.com") });
    expect(old.output).toMatchObject({ created: true });
  });

  it("IT-34.05 every member sees the requests, but an agent can't decide them", async () => {
    as("AGENT");
    const listed = await (await refundsRoute.GET(new Request("http://localhost/api/refund-requests?view=pending"))).json();
    expect(listed).toMatchObject({ pendingCount: 2, refundWindowDays: 90, shopifyConnected: true, canDecide: false, canEditSettings: false });
    expect(listed.requests.map((item: { orderNumber: string }) => item.orderNumber).sort()).toEqual(["2001", "2002"]);

    const request = await prisma.refundRequest.findFirstOrThrow({ where: { workspaceId: ids.store, orderNumber: "2001" } });
    expect((await decide(request.id, { decision: "approve" })).status).toBe(403);
    expect((await prisma.refundRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");
  });

  it("IT-34.06 a manager approves: the order is refunded in Shopify, the customer is told in the chat, and it is audited", async () => {
    as("MANAGER");
    const request = await prisma.refundRequest.findFirstOrThrow({ where: { workspaceId: ids.store, orderNumber: "2001" } });
    const response = await decide(request.id, { decision: "approve", note: "Photo shows the dent" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "REFUNDED", delivered: "conversation" });
    expect(shop.calls).toEqual(expect.arrayContaining(["POST /admin/api/2024-10/orders/5001/refunds/calculate.json", "POST /admin/api/2024-10/orders/5001/refunds.json"]));

    const saved = await prisma.refundRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(saved).toMatchObject({ status: "REFUNDED", externalRefundId: "9901", decidedById: ids.manager, decisionNote: "Photo shows the dent" });
    const told = await prisma.chatMessage.findFirstOrThrow({ where: { sessionId: ids.openChat, sender: "AGENT" } });
    expect(told.content).toMatch(/refund of PKR 4,500 for order #2001 has been approved/);
    expect(await prisma.auditLog.count({ where: { workspaceId: ids.store, action: "refund.approved", targetId: request.id } })).toBe(1);

    expect((await decide(request.id, { decision: "decline" })).status).toBe(409);
  });

  it("IT-34.07 a Shopify refund that fails is kept for a retry without breaking the connector; declining emails the customer once the chat has ended", async () => {
    as("MANAGER");
    const request = await prisma.refundRequest.findFirstOrThrow({ where: { workspaceId: ids.store, orderNumber: "2002" } });

    shop.scopeMissing = true;
    expect(await (await decide(request.id, { decision: "approve" })).json()).toMatchObject({ status: "FAILED", error: expect.stringMatching(/write_orders/) });
    shop.scopeMissing = false;
    expect(await (await decide(request.id, { decision: "approve" })).json()).toMatchObject({ status: "FAILED", error: expect.stringMatching(/nothing left to refund/) });
    expect((await prisma.connector.findFirstOrThrow({ where: { workspaceId: ids.store, provider: "SHOPIFY" } })).status).toBe("CONNECTED");

    const declined = await (await decide(request.id, { decision: "decline", note: "Outside our usual policy" })).json();
    expect(declined).toMatchObject({ status: "DECLINED", delivered: "email" });
    expect(emails.at(-1)).toMatchObject({ to: ["sara@example.com"], subject: "Your refund request for order #2002" });
    expect(emails.at(-1)!.text).toMatch(/unable to approve it: Outside our usual policy/);
  });

  it("IT-34.08 without a store the request is checked by the team: it needs a contact detail and approving marks it for payout", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ASSISTDESK_SAMPLE_STORE", "");
    try {
      const refund = await tool(ids.plain, "request_refund");
      const anonymous = await runTool({ tool: refund, rawInput: { order_number: "7788", reason: "Wrong size" }, ctx: ctx(ids.plain, ids.plainChat, null) });
      expect(anonymous.output).toMatchObject({ created: false });

      const created = await runTool({ tool: refund, rawInput: { order_number: "7788", reason: "Wrong size", email: "omar@example.com" }, ctx: ctx(ids.plain, ids.plainChat, null) });
      expect(created.output).toMatchObject({ created: true, amount: null });

      const request = await prisma.refundRequest.findFirstOrThrow({ where: { workspaceId: ids.plain } });
      expect(request).toMatchObject({ source: "MANUAL", customerEmail: "omar@example.com" });
      const manager = await prisma.user.create({ data: { workspaceId: ids.plain, fullName: "Plain Manager", username: `ref-pm-${suffix}`, email: `ref-pm-${suffix}@example.com`, role: "MANAGER" } });
      signedIn.current = { user: { id: manager.id, role: "MANAGER", workspaceId: ids.plain, fullName: "Plain Manager" } };

      // Another workspace's request can't be decided from here.
      const foreign = await prisma.refundRequest.findFirstOrThrow({ where: { workspaceId: ids.store, status: "REFUNDED" } });
      expect((await decide(foreign.id, { decision: "decline" })).status).toBe(404);

      expect(await (await decide(request.id, { decision: "approve" })).json()).toMatchObject({ status: "APPROVED", delivered: "conversation" });
      const told = await prisma.chatMessage.findFirstOrThrow({ where: { sessionId: ids.plainChat, sender: "AGENT" } });
      expect(told.content).toMatch(/Our team will process the payment/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("IT-34.09 the invoice link shows the customer's own order and expires", async () => {
    const invoiceTool = await tool(ids.store, "get_invoice");
    const stranger = await runTool({ tool: invoiceTool, rawInput: { order_number: "2001", email: "intruder@example.com" }, ctx: ctx(ids.store, ids.openChat, null, "MODEL") });
    expect(stranger.output).toMatchObject({ found: false });

    const mine = await runTool({ tool: invoiceTool, rawInput: { order_number: "2001" }, ctx: ctx(ids.store, ids.openChat, "sara@example.com", "MODEL") });
    expect(mine.output).toMatchObject({ found: true, invoiceNumber: "INV-2001", total: "PKR 4500" });
    const token = (mine.output as { link: string }).link.split("/invoice/")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const invoice = await loadOrderInvoice(token);
    expect(invoice).toMatchObject({
      store: { name: `Kettle Store ${suffix}`, supportEmail: "help@kettle.example" },
      data: { orderNumber: "2001", customerName: "Sara Iqbal", subtotal: 3846.15, tax: 653.85, total: 4500, sample: false, lines: [{ description: "Steel kettle", quantity: 1, unitPrice: 3846.15 }] },
    });

    await prisma.orderInvoice.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await loadOrderInvoice(token)).toBeNull();
  });

  it("IT-34.10 a sample-store invoice is marked as sample data, and without any store the AI says invoices aren't available", async () => {
    const invoiceTool = await tool(ids.plain, "get_invoice");
    const sample = await runTool({ tool: invoiceTool, rawInput: { order_number: "1042" }, ctx: ctx(ids.plain, ids.plainChat, "omar@example.com", "MODEL") });
    expect(sample.output).toMatchObject({ found: true, invoiceNumber: "INV-1042" });
    const token = (sample.output as { link: string }).link.split("/invoice/")[1];
    expect((await loadOrderInvoice(token))?.data.sample).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ASSISTDESK_SAMPLE_STORE", "");
    try {
      const none = await runTool({ tool: invoiceTool, rawInput: { order_number: "1042" }, ctx: ctx(ids.plain, ids.plainChat, "omar@example.com", "MODEL") });
      expect((none.output as { note: string }).note).toMatch(/no store is connected/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
