import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/prisma";
import { encryptSecret } from "@/src/lib/secrets";
import type { ToolContext } from "@/src/lib/tools/builtin-tools";
import { CONFIRMATION_TTL_MS, type RuntimeTool, ensureBuiltInTools, expireStaleConfirmations, loadAgentToolset, resolvePendingConfirmation, runTool, toRuntimeTool } from "@/src/lib/tools/registry";

/**
 * Module 2 increment 1: registry, built-in tools, HTTP tools, confirmations and the
 * action log, against a real database and a mock external API.
 */

const suffix = Date.now().toString(36);
let workspaceId = "";
let agentId = "";
let contactA = "";
let sessionA = "";
let sessionB = "";
let ticketOwn = 0;
let ticketOther = 0;
let server: http.Server;
let baseUrl = "";
const received: Array<{ method: string; url: string; auth: string | undefined; body: string }> = [];

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceId,
    agentId,
    runId: null,
    step: 1,
    sessionId: sessionA,
    ticketId: null,
    contactId: contactA,
    channel: "WEB_WIDGET",
    verifiedIdentity: true,
    customer: { name: "Ayesha Khan", email: "ayesha@example.com", phone: "+923001234567" },
    timeZone: "Asia/Karachi",
    dryRun: false,
    triggeredBy: "MODEL",
    ...overrides,
  };
}

async function tool(key: string): Promise<RuntimeTool> {
  const row = await prisma.agentTool.findFirstOrThrow({ where: { workspaceId, key } });
  return toRuntimeTool(row) as RuntimeTool;
}

beforeAll(async () => {
  server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({ method: request.method ?? "", url: request.url ?? "", auth: request.headers.authorization, body });

      if (request.url?.startsWith("/slow")) {
        setTimeout(() => response.end("{}"), 3000);
        return;
      }

      if (request.headers.authorization !== "Bearer store-secret") {
        response.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "bad key" }));
        return;
      }

      if (request.url?.startsWith("/orders/1042")) {
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ order: { status: "SHIPPED", eta: "2026-10-06", internal: "hidden" } }));
      } else if (request.url?.startsWith("/invoices") && request.method === "POST") {
        response.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ invoiceNumber: "INV-1042", received: JSON.parse(body || "{}") }));
      } else {
        response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "store is down" }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const workspace = await prisma.workspace.create({
    data: {
      name: `M2 tools ${suffix}`,
      slug: `m2-tools-${suffix}`,
      supportEmail: `support-${suffix}@example.com`,
      settings: {
        create: {
          timezone: "Asia/Karachi",
          appointmentSlotMinutes: 30,
          appointmentHours: { days: [1, 2, 3, 4, 5, 6, 7], start: "09:00", end: "17:00" },
          appointmentDaysAhead: 14,
        },
      },
    },
  });
  workspaceId = workspace.id;
  const inbox = await prisma.inbox.create({ data: { workspaceId, name: "Support", emailPrefix: `support-${suffix}`, ticketPrefix: "TT" } });
  const agent = await prisma.aIAgent.create({ data: { workspaceId, name: "Tool agent", provider: "Default", model: "groq/llama-3.3-70b-versatile", status: "ACTIVE", toolsEnabled: true } });
  agentId = agent.id;

  const a = await prisma.contact.create({ data: { workspaceId, name: "Ayesha Khan", email: "ayesha@example.com", phone: "+923001234567", visitorId: `visitor-a-${suffix}-xxxxxxxx` } });
  const b = await prisma.contact.create({ data: { workspaceId, name: "Other Person", email: "other@example.com" } });
  contactA = a.id;
  sessionA = (await prisma.chatSession.create({ data: { workspaceId, channel: "WEB_WIDGET", contactId: a.id, customerName: "Ayesha Khan", customerEmail: "ayesha@example.com" } })).id;
  sessionB = (await prisma.chatSession.create({ data: { workspaceId, channel: "WEB_WIDGET", contactId: b.id, customerName: "Other Person" } })).id;
  ticketOwn = (await prisma.ticket.create({ data: { workspaceId, inboxId: inbox.id, ticketNumber: 700001, subject: "Kettle leaking", contactId: a.id, requesterEmail: "ayesha@example.com", status: "IN_PROGRESS" } })).ticketNumber;
  ticketOther = (await prisma.ticket.create({ data: { workspaceId, ticketNumber: 700002, subject: "Private matter", contactId: b.id, requesterEmail: "other@example.com" } })).ticketNumber;

  await ensureBuiltInTools(workspaceId);
  await ensureBuiltInTools(workspaceId); // idempotent

  const header = [{ name: "Authorization", value: encryptSecret("Bearer store-secret"), secret: true }];
  await prisma.agentTool.createMany({
    data: [
      {
        workspaceId,
        key: "track_order",
        name: "Track order",
        description: "Get the delivery status of an order.",
        type: "HTTP",
        parameters: [{ name: "order_number", type: "string", description: "Order number", required: true }],
        httpMethod: "GET",
        httpUrl: `${baseUrl}/orders/{order_number}`,
        httpHeaders: header,
        responseFields: ["order.status", "order.eta"],
      },
      {
        workspaceId,
        key: "generate_invoice",
        name: "Generate invoice",
        description: "Create an invoice for an order.",
        type: "HTTP",
        parameters: [{ name: "order_number", type: "string", description: "Order number", required: true }],
        httpMethod: "POST",
        httpUrl: `${baseUrl}/invoices`,
        httpHeaders: header,
        httpBody: '{"order": "{order_number}", "source": "assistdesk"}',
      },
      {
        workspaceId,
        key: "broken_api",
        name: "Broken API",
        description: "Always fails.",
        type: "HTTP",
        parameters: [],
        httpMethod: "GET",
        httpUrl: `${baseUrl}/broken`,
        httpHeaders: header,
      },
      {
        workspaceId,
        key: "slow_api",
        name: "Slow API",
        description: "Never answers in time.",
        type: "HTTP",
        parameters: [],
        httpMethod: "GET",
        httpUrl: `${baseUrl}/slow`,
        httpTimeoutMs: 1000,
      },
    ],
  });

  const all = await prisma.agentTool.findMany({ where: { workspaceId } });
  await prisma.agentToolBinding.createMany({ data: all.filter((row) => row.key !== "slow_api").map((row) => ({ agentId, toolId: row.id })) });
});

afterAll(async () => {
  server?.close();
  if (workspaceId) {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  }
  await prisma.$disconnect();
});

describe("registry", () => {
  it("creates the built-in tools once and loads the agent's enabled tools", async () => {
    expect(await prisma.agentTool.count({ where: { workspaceId, type: "BUILT_IN" } })).toBe(8);

    const { tools, settings } = await loadAgentToolset(workspaceId, agentId);
    expect(tools.map((item) => item.key)).toEqual(expect.arrayContaining(["get_customer_info", "book_appointment", "track_order"]));
    expect(tools.map((item) => item.key)).not.toContain("slow_api"); // not bound
    expect(settings?.maxToolSteps).toBe(4);

    await prisma.agentTool.updateMany({ where: { workspaceId, key: "broken_api" }, data: { isEnabled: false } });
    expect((await loadAgentToolset(workspaceId, agentId)).tools.map((item) => item.key)).not.toContain("broken_api");
    await prisma.agentTool.updateMany({ where: { workspaceId, key: "broken_api" }, data: { isEnabled: true } });

    await prisma.aIAgent.update({ where: { id: agentId }, data: { toolsEnabled: false } });
    expect((await loadAgentToolset(workspaceId, agentId)).tools).toHaveLength(0);
    await prisma.aIAgent.update({ where: { id: agentId }, data: { toolsEnabled: true } });
  });

  it("rejects invalid input and logs it", async () => {
    const result = await runTool({ tool: await tool("lookup_ticket_status"), rawInput: {}, ctx: ctx() });
    expect(result.status).toBe("ERROR");
    expect((result.output as { error: string }).error).toContain('"reference" is required');
    const row = await prisma.toolExecution.findUniqueOrThrow({ where: { id: result.executionId as string } });
    expect(row.status).toBe("ERROR");
  });
});

describe("built-in tools (FE-1)", () => {
  it("get_customer_info returns the customer's record with masked details", async () => {
    const result = await runTool({ tool: await tool("get_customer_info"), rawInput: { reason: "Check what we know" }, ctx: ctx() });
    const output = result.output as { known: boolean; email: string; openTickets: Array<{ reference: string }> };
    expect(output.known).toBe(true);
    expect(output.email).toBe("a***@example.com");
    expect(output.openTickets[0].reference).toBe(`TT-${ticketOwn}`);

    const row = await prisma.toolExecution.findUniqueOrThrow({ where: { id: result.executionId as string } });
    expect(row.reasoning).toBe("Check what we know");
    expect(row.status).toBe("SUCCESS");
  });

  it("an unverified visitor gets counts, not ticket subjects", async () => {
    const result = await runTool({ tool: await tool("get_customer_info"), rawInput: {}, ctx: ctx({ verifiedIdentity: false }) });
    expect((result.output as { openTickets: unknown }).openTickets).toBe(1);
  });

  it("lookup_ticket_status only reveals the customer's own tickets", async () => {
    const own = await runTool({ tool: await tool("lookup_ticket_status"), rawInput: { reference: `TT-${ticketOwn}` }, ctx: ctx() });
    expect(own.output).toMatchObject({ found: true, status: "IN_PROGRESS", subject: "Kettle leaking" });

    const other = await runTool({ tool: await tool("lookup_ticket_status"), rawInput: { reference: `#${ticketOther}` }, ctx: ctx() });
    expect(other.output).toMatchObject({ found: false });
    expect(JSON.stringify(other.output)).not.toContain("Private matter");

    const garbage = await runTool({ tool: await tool("lookup_ticket_status"), rawInput: { reference: "abc" }, ctx: ctx() });
    expect(garbage.status).toBe("ERROR");
  });

  it("create_ticket opens a ticket linked to the customer; dry run does not", async () => {
    const dry = await runTool({ tool: await tool("create_ticket"), rawInput: { subject: "Test", description: "x" }, ctx: ctx({ dryRun: true }) });
    expect(dry.output).toMatchObject({ simulated: true });

    const result = await runTool({
      tool: await tool("create_ticket"),
      rawInput: { subject: "Damaged kettle", description: "Arrived cracked, order 1042, wants a replacement", priority: "HIGH", reason: "Needs the team" },
      ctx: ctx(),
    });
    const output = result.output as { created: boolean; reference: string };
    expect(output.created).toBe(true);
    expect(output.reference).toMatch(/^TT-\d+$/);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { workspaceId, subject: "Damaged kettle" } });
    expect(ticket).toMatchObject({ contactId: contactA, priority: "HIGH", source: "WEB", requesterEmail: "ayesha@example.com" });
    expect(await prisma.notification.count({ where: { workspaceId, type: "NEW_TICKET" } })).toBe(1);
  });

  it("capture_lead saves an AI_TOOL lead with the interest", async () => {
    const result = await runTool({ tool: await tool("capture_lead"), rawInput: { interest: "50 kettles for a hotel", company: "Grand Hotel", email: "a***@example.com" }, ctx: ctx() });
    expect(result.output).toMatchObject({ saved: true });
    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId, email: "ayesha@example.com" } });
    expect(lead).toMatchObject({ source: "AI_TOOL", company: "Grand Hotel", intent: "50 kettles for a hotel" });
  });

  it("booking needs the customer's confirmation, then books; a taken slot is refused", async () => {
    const availability = await runTool({ tool: await tool("check_availability"), rawInput: {}, ctx: ctx() });
    const slots = (availability.output as { slots: Array<{ startsAt: string }> }).slots;
    expect(slots.length).toBeGreaterThan(1);

    const request = await runTool({ tool: await tool("book_appointment"), rawInput: { starts_at: slots[0].startsAt, topic: "Bulk order", email: "a***@example.com", phone: "********4567" }, ctx: ctx() });
    expect(request.status).toBe("PENDING_CONFIRMATION");
    expect(JSON.stringify(request.output)).toContain("Shall I go ahead?");
    expect(await prisma.appointment.count({ where: { workspaceId } })).toBe(0);

    expect(await resolvePendingConfirmation({ message: "what's the address?", ctx: ctx() })).toMatchObject({ state: "STILL_PENDING" });

    const confirmed = await resolvePendingConfirmation({ message: "Yes please", ctx: ctx() });
    expect(confirmed).toMatchObject({ state: "EXECUTED", status: "SUCCESS" });
    expect(await prisma.appointment.count({ where: { workspaceId, status: "BOOKED" } })).toBe(1);
    // Masked details the model echoed back are never stored: the session's real ones are.
    expect(await prisma.appointment.findFirstOrThrow({ where: { workspaceId, status: "BOOKED" } })).toMatchObject({ email: "ayesha@example.com", phone: "+923001234567" });
    const row = await prisma.toolExecution.findUniqueOrThrow({ where: { id: request.executionId as string } });
    expect(row).toMatchObject({ status: "SUCCESS", triggeredBy: "CONFIRMATION" });

    // Another customer tries the same slot.
    await runTool({
      tool: await tool("book_appointment"),
      rawInput: { starts_at: slots[0].startsAt, name: "Other Person", email: "other@example.com" },
      ctx: ctx({ sessionId: sessionB, contactId: null, customer: { name: "Other Person", email: "other@example.com", phone: null } }),
    });
    const second = await resolvePendingConfirmation({ message: "ok", ctx: ctx({ sessionId: sessionB, contactId: null }) });
    expect(second).toMatchObject({ state: "EXECUTED", status: "ERROR" });
    expect(JSON.stringify((second as { output: unknown }).output)).toContain("taken");
  });

  it("unanswered confirmations expire after the window", async () => {
    const stale = await prisma.toolExecution.create({
      data: { workspaceId, sessionId: sessionA, toolKey: "book_appointment", toolName: "Book appointment", input: {}, status: "PENDING_CONFIRMATION", createdAt: new Date(Date.now() - CONFIRMATION_TTL_MS - 60_000) },
    });
    const fresh = await prisma.toolExecution.create({ data: { workspaceId, sessionId: sessionB, toolKey: "book_appointment", toolName: "Book appointment", input: {}, status: "PENDING_CONFIRMATION" } });

    expect(await expireStaleConfirmations()).toBeGreaterThanOrEqual(1);
    expect((await prisma.toolExecution.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("CANCELLED");
    expect((await prisma.toolExecution.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("PENDING_CONFIRMATION");
    await prisma.toolExecution.delete({ where: { id: fresh.id } });
  });

  it("'no' cancels a pending action", async () => {
    const availability = await runTool({ tool: await tool("check_availability"), rawInput: {}, ctx: ctx() });
    const slot = (availability.output as { slots: Array<{ startsAt: string }> }).slots[1];
    await runTool({ tool: await tool("book_appointment"), rawInput: { starts_at: slot.startsAt }, ctx: ctx() });
    expect(await resolvePendingConfirmation({ message: "no, cancel", ctx: ctx() })).toMatchObject({ state: "CANCELLED" });
    expect(await resolvePendingConfirmation({ message: "yes", ctx: ctx() })).toMatchObject({ state: "NONE" });
  });

  it("escalate_to_human hands the chat to the team", async () => {
    const result = await runTool({ tool: await tool("escalate_to_human"), rawInput: { summary: "Wants a refund for a damaged kettle" }, ctx: ctx({ sessionId: sessionB, contactId: null }) });
    expect(result.output).toMatchObject({ handedOver: true });
    const session = await prisma.chatSession.findUniqueOrThrow({ where: { id: sessionB } });
    expect(session.status).toBe("ESCALATED");
    expect(await prisma.sessionEvent.count({ where: { sessionId: sessionB, type: "HUMAN_TAKEOVER" } })).toBe(1);
  });
});

describe("HTTP tools (FE-2b custom actions)", () => {
  it("calls the external API with the decrypted secret header and keeps only chosen fields", async () => {
    const result = await runTool({ tool: await tool("track_order"), rawInput: { order_number: "1042", reason: "Customer asked where the order is" }, ctx: ctx() });
    expect(result.output).toEqual({ "order.status": "SHIPPED", "order.eta": "2026-10-06" });
    expect(received.at(-1)).toMatchObject({ method: "GET", url: "/orders/1042", auth: "Bearer store-secret" });

    const row = await prisma.toolExecution.findUniqueOrThrow({ where: { id: result.executionId as string } });
    expect(JSON.stringify(row)).not.toContain("store-secret");
  });

  it("simulates writes in dry run and sends the JSON body for real", async () => {
    const before = received.length;
    const dry = await runTool({ tool: await tool("generate_invoice"), rawInput: { order_number: "1042" }, ctx: ctx({ dryRun: true }) });
    expect(dry.output).toMatchObject({ simulated: true });
    expect(received.length).toBe(before);

    const real = await runTool({ tool: await tool("generate_invoice"), rawInput: { order_number: "1042" }, ctx: ctx() });
    expect(real.output).toMatchObject({ invoiceNumber: "INV-1042", received: { order: "1042", source: "assistdesk" } });
  });

  it("reports API errors and timeouts as failed actions", async () => {
    const broken = await runTool({ tool: await tool("broken_api"), rawInput: {}, ctx: ctx() });
    expect(broken.status).toBe("ERROR");
    expect(JSON.stringify(broken.output)).toContain("HTTP 500");

    const slow = await runTool({ tool: await tool("slow_api"), rawInput: {}, ctx: ctx() });
    expect(slow.status).toBe("ERROR");
    expect(JSON.stringify(slow.output)).toContain("did not answer in time");
  });
});
