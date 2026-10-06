import http from "node:http";
import type { AddressInfo } from "node:net";
import { AIMessage, type BaseMessage, ToolMessage } from "@langchain/core/messages";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ToolCallingModel } from "@/src/lib/agent-engine/model-chain";
import { type AgentReplyInput, runAgentReply } from "@/src/lib/agent-engine/run-agent";
import { parseRunTrace } from "@/src/lib/agent-engine/run-trace";
import { prisma } from "@/src/lib/prisma";
import { ensureBuiltInTools, loadAgentToolset } from "@/src/lib/tools/registry";

/**
 * Module 2 increment 2: the LangGraph reasoning engine with a scripted model, so the
 * orchestration (multi-step plans, confirmations, fallbacks, limits, rules, failure
 * escalation and the action log) is tested without depending on an LLM provider.
 */

const suffix = Date.now().toString(36);
let workspaceId = "";
let agentId = "";
let contactId = "";
let server: http.Server;
let baseUrl = "";

type Script = (messages: BaseMessage[], options: { tools: Array<{ name: string }>; forcedTool?: string | null }) => AIMessage;

function scripted(id: string, script: Script, calls: Array<{ tools: string[]; forcedTool?: string | null }> = []): ToolCallingModel {
  return {
    id,
    async invoke(messages, options) {
      calls.push({ tools: options.tools.map((tool) => tool.name), forcedTool: options.forcedTool ?? null });
      return script(messages, options);
    },
  };
}

const failing = (id: string): ToolCallingModel => ({
  id,
  async invoke() {
    throw new Error("429 rate limit");
  },
});

function toolResults(messages: BaseMessage[]) {
  return messages.filter((message): message is ToolMessage => message instanceof ToolMessage).map((message) => ({ name: message.name, content: JSON.parse(String(message.content)) }));
}

const call = (name: string, args: Record<string, unknown>, id = `${name}_${Math.random().toString(36).slice(2, 7)}`) =>
  new AIMessage({ content: "", tool_calls: [{ id, name, args, type: "tool_call" }] });

async function newSession() {
  return (await prisma.chatSession.create({ data: { workspaceId, channel: "WEB_WIDGET", contactId, customerName: "Ayesha Khan", customerEmail: "ayesha@example.com" } })).id;
}

async function input(sessionId: string, question: string, models: ToolCallingModel[], settings?: Partial<AgentReplyInput["settings"]>): Promise<AgentReplyInput> {
  const { tools, settings: stored } = await loadAgentToolset(workspaceId, agentId);
  return {
    agent: { id: agentId, provider: "Default", model: "groq/llama-3.3-70b-versatile", apiKey: null, systemPrompt: "You are the Kettle Shop assistant.", confidenceThreshold: 0.5 },
    workspaceId,
    channel: "WEB_WIDGET",
    source: "CHAT",
    question,
    history: [],
    sources: [],
    tools,
    settings: { maxToolSteps: stored?.maxToolSteps ?? 4, escalateOnToolFailure: stored?.escalateOnToolFailure ?? true, intentRules: stored?.intentRules ?? null, ...settings },
    ctx: {
      workspaceId,
      sessionId,
      ticketId: null,
      contactId,
      channel: "WEB_WIDGET",
      verifiedIdentity: true,
      customer: { name: "Ayesha Khan", email: "ayesha@example.com", phone: "+923001234567" },
      timeZone: "Asia/Karachi",
      dryRun: false,
      triggeredBy: "MODEL",
    },
    models,
  };
}

beforeAll(async () => {
  server = http.createServer((_request, response) => response.writeHead(503).end(JSON.stringify({ error: "maintenance" })));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const workspace = await prisma.workspace.create({
    data: {
      name: `M2 engine ${suffix}`,
      slug: `m2-engine-${suffix}`,
      supportEmail: `engine-${suffix}@example.com`,
      settings: { create: { timezone: "Asia/Karachi", appointmentHours: { days: [1, 2, 3, 4, 5, 6, 7], start: "09:00", end: "17:00" } } },
    },
  });
  workspaceId = workspace.id;
  agentId = (await prisma.aIAgent.create({ data: { workspaceId, name: "Engine agent", provider: "Default", model: "groq/llama-3.3-70b-versatile", status: "ACTIVE", toolsEnabled: true } })).id;
  contactId = (await prisma.contact.create({ data: { workspaceId, name: "Ayesha Khan", email: "ayesha@example.com" } })).id;
  await ensureBuiltInTools(workspaceId);
  await prisma.agentTool.create({
    data: { workspaceId, key: "track_order", name: "Track order", description: "Order status.", type: "HTTP", parameters: [{ name: "order_number", type: "string", description: "Order", required: true }], httpMethod: "GET", httpUrl: `${baseUrl}/orders/{order_number}` },
  });
  const tools = await prisma.agentTool.findMany({ where: { workspaceId } });
  await prisma.agentToolBinding.createMany({ data: tools.map((tool) => ({ agentId, toolId: tool.id })) });
});

afterAll(async () => {
  server?.close();
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
  await prisma.$disconnect();
});

describe("multi-step reasoning (FE-2) with confirmation", () => {
  it("checks availability, asks to confirm the booking, then books on 'yes'", async () => {
    const sessionId = await newSession();
    const model = scripted("scripted/planner", (messages) => {
      const results = toolResults(messages);

      if (results.length === 0) return call("check_availability", { reason: "Customer wants an appointment" });

      if (results.length === 1) {
        const slot = results[0].content.slots[0].startsAt;
        return call("book_appointment", { starts_at: slot, topic: "Bulk kettle order", reason: "Customer picked the first slot" });
      }

      return new AIMessage("I can book the first available slot for you. Shall I go ahead?");
    });

    const first = await runAgentReply(await input(sessionId, "I'd like to book a consultation about a bulk order", [model]));
    expect(first.status).toBe("AWAITING_CONFIRMATION");
    expect(first.reply).toContain("Shall I go ahead");
    expect(first.trace.filter((entry) => entry.type === "tool").map((entry) => entry.type === "tool" && entry.toolKey)).toEqual(["check_availability", "book_appointment"]);
    expect(await prisma.appointment.count({ where: { workspaceId } })).toBe(0);

    const executions = await prisma.toolExecution.findMany({ where: { runId: first.runId }, orderBy: { createdAt: "asc" } });
    expect(executions.map((row) => [row.toolKey, row.status, row.step])).toEqual([
      ["check_availability", "SUCCESS", 1],
      ["book_appointment", "PENDING_CONFIRMATION", 2],
    ]);
    expect(executions[1].reasoning).toBe("Customer picked the first slot");
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: first.runId } });
    expect(run).toMatchObject({ status: "AWAITING_CONFIRMATION", steps: 3, toolCalls: 2, model: "scripted/planner" });
    // FE-5: the stored chain of thought references the logged actions.
    const storedTrace = parseRunTrace(run.trace);
    expect(storedTrace.filter((entry) => entry.type === "tool").map((entry) => entry.type === "tool" && [entry.toolKey, entry.status, entry.executionId])).toEqual([
      ["check_availability", "SUCCESS", executions[0].id],
      ["book_appointment", "PENDING_CONFIRMATION", executions[1].id],
    ]);

    // The customer says yes: the server books before the model answers.
    const confirmCalls: Array<{ tools: string[] }> = [];
    const confirmModel = scripted(
      "scripted/confirm",
      (messages) => {
        const system = String(messages[0].content);
        return new AIMessage(system.includes("The customer just confirmed") ? "Your appointment is booked!" : "Hmm?");
      },
      confirmCalls,
    );
    const second = await runAgentReply(await input(sessionId, "Yes please", [confirmModel]));
    expect(second.confirmation).toBe("EXECUTED");
    // The booking that just ran can't be proposed again in the same turn.
    expect(confirmCalls[0].tools).not.toContain("book_appointment");
    expect(confirmCalls[0].tools).toContain("check_availability");
    expect(second.reply).toBe("Your appointment is booked!");
    expect(await prisma.appointment.count({ where: { workspaceId, status: "BOOKED" } })).toBe(1);

    const secondRun = await prisma.agentRun.findUniqueOrThrow({ where: { id: second.runId } });
    expect(parseRunTrace(secondRun.trace)[0]).toMatchObject({ type: "confirmation", state: "EXECUTED", status: "SUCCESS", executionId: executions[1].id });
    // The confirmed action now belongs to the run that executed it.
    expect((await prisma.toolExecution.findUniqueOrThrow({ where: { id: executions[1].id } })).runId).toBe(second.runId);
  });

  it("answers deterministically after a confirmation when no model is reachable", async () => {
    const sessionId = await newSession();
    const plan = scripted("scripted/planner", (messages) => {
      const results = toolResults(messages);
      if (results.length === 0) return call("check_availability", {});
      if (results.length === 1) return call("book_appointment", { starts_at: results[0].content.slots[1].startsAt });
      return new AIMessage("Shall I book it?");
    });
    await runAgentReply(await input(sessionId, "book me in", [plan]));

    const result = await runAgentReply(await input(sessionId, "ok", [failing("down/model")]));
    expect(result.confirmation).toBe("EXECUTED");
    expect(result.reply).toMatch(/^Done: Book an appointment/);
  });
});

describe("customer consent given to the assistant's own question", () => {
  const booker = (slotIndex: number) =>
    scripted("scripted/booker", (messages) => {
      const results = toolResults(messages);
      if (results.length === 0) return call("check_availability", { reason: "Find the slot" });
      if (results.length === 1) return call("book_appointment", { starts_at: results[0].content.slots[slotIndex].startsAt, reason: "Customer agreed" });
      return new AIMessage(String(results[1].content.booked ? "Booked!" : "Please confirm."));
    });

  it("a clear yes to the assistant's question books once, without asking again", async () => {
    const sessionId = await newSession();
    const before = await prisma.appointment.count({ where: { workspaceId } });
    const request = await input(sessionId, "Yes please, go ahead", [booker(2)]);
    request.history = [
      { role: "user", content: "Can I book tomorrow at 10?" },
      { role: "assistant", content: "10:00 tomorrow is free. Shall I book it for you?" },
    ];
    const result = await runAgentReply(request);

    expect(result.reply).toBe("Booked!");
    expect(await prisma.appointment.count({ where: { workspaceId } })).toBe(before + 1);
    const booking = await prisma.toolExecution.findFirstOrThrow({ where: { runId: result.runId, toolKey: "book_appointment" } });
    expect(booking).toMatchObject({ status: "SUCCESS", triggeredBy: "CONFIRMATION" });
    expect(booking.reasoning).toContain(`confirmed by the customer's reply: "Yes please, go ahead"`);
  });

  it("still asks when the customer didn't answer a question, or said something else", async () => {
    for (const [question, lastAssistant] of [
      ["Yes please", "Your order has shipped."],
      ["Book me in at 11", "Anything else I can help with?"],
    ] as const) {
      const sessionId = await newSession();
      const request = await input(sessionId, question, [booker(3)]);
      request.history = [{ role: "assistant", content: lastAssistant }];
      const result = await runAgentReply(request);
      const booking = await prisma.toolExecution.findFirstOrThrow({ where: { runId: result.runId, toolKey: "book_appointment" } });
      expect(booking.status).toBe("PENDING_CONFIRMATION");
    }
  });
});

describe("resilience", () => {
  it("falls back to the next model when one fails", async () => {
    const sessionId = await newSession();
    const result = await runAgentReply(await input(sessionId, "hi", [failing("primary/model"), scripted("backup/model", () => new AIMessage("Hello! How can I help?"))]));
    expect(result.reply).toBe("Hello! How can I help?");
    expect(result.modelUsed).toBe("backup/model");
    expect(result.trace.some((entry) => entry.type === "model_error" && entry.model === "primary/model")).toBe(true);
  });

  it("answers from the tool result when the model fails after the tool call", async () => {
    const sessionId = await newSession();
    const ticket = await prisma.ticket.create({ data: { workspaceId, ticketNumber: 900001, subject: "Refund", status: "IN_PROGRESS", contactId } });
    let calls = 0;
    const flaky: ToolCallingModel = {
      id: "scripted/flaky",
      async invoke() {
        calls += 1;
        if (calls === 1) return call("lookup_ticket_status", { reference: String(ticket.ticketNumber), reason: "Customer asked" });
        throw new Error("429 rate limit");
      },
    };
    const result = await runAgentReply(await input(sessionId, "status of ticket 900001?", [flaky]));
    expect(result.status).toBe("FALLBACK");
    expect(result.reply).toBe('Your ticket AD-900001 ("Refund") is in progress — our team is working on it.');
    const trace = parseRunTrace((await prisma.agentRun.findUniqueOrThrow({ where: { id: result.runId } })).trace);
    expect(trace.map((entry) => entry.type)).toEqual(["tool", "model_error", "fallback"]);
    expect(trace.at(-1)).toMatchObject({ kind: "tool_results" });
  });

  it("uses the knowledge-base answer when no model can reason", async () => {
    const sessionId = await newSession();
    const result = await runAgentReply(await input(sessionId, "What are your opening hours?", [failing("a"), failing("b")]));
    expect(result.reply.length).toBeGreaterThan(10);
    expect(["FALLBACK", "FAILED"]).toContain(result.status);
    expect((await prisma.agentRun.findUniqueOrThrow({ where: { id: result.runId } })).status).toBe(result.status);
  });

  it("stops at the step limit and makes the model answer without tools", async () => {
    const sessionId = await newSession();
    const calls: Array<{ tools: string[] }> = [];
    const looping = scripted("scripted/looper", (_messages, options) => (options.tools.length ? call("get_customer_info", {}) : new AIMessage("Here is what I found.")), calls);
    const result = await runAgentReply(await input(sessionId, "tell me everything", [looping], { maxToolSteps: 2 }));
    expect(result.status).toBe("MAX_STEPS");
    expect(result.reply).toBe("Here is what I found.");
    expect(result.toolCalls).toBe(2);
    expect(calls.at(-1)?.tools).toEqual([]);
  });

  it("tells the model about unknown tools instead of crashing", async () => {
    const sessionId = await newSession();
    const result = await runAgentReply(
      await input(sessionId, "do magic", [scripted("scripted/x", (messages) => (toolResults(messages).length ? new AIMessage("I can't do that.") : call("delete_everything", {})))]),
    );
    expect(result.reply).toBe("I can't do that.");
  });
});

describe("intent rules (FE-4) and failure handling", () => {
  it("an ALWAYS rule forces the first tool call", async () => {
    const sessionId = await newSession();
    const calls: Array<{ tools: string[]; forcedTool?: string | null }> = [];
    const model = scripted("scripted/rules", (messages) => (toolResults(messages).length ? new AIMessage("Your order is on its way.") : call("track_order", { order_number: "1042" })), calls);
    await runAgentReply(
      await input(sessionId, "Where is my order 1042?", [model], {
        intentRules: [{ id: "r1", phrases: ["where is my order", "track my order"], toolKey: "track_order", mode: "ALWAYS" }],
        escalateOnToolFailure: false,
      }),
    );
    expect(calls[0].forcedTool).toBe("track_order");
    expect(calls[1].forcedTool).toBeNull();
    const run = await prisma.agentRun.findFirstOrThrow({ where: { sessionId }, orderBy: { createdAt: "desc" } });
    expect(parseRunTrace(run.trace)[0]).toEqual({ type: "intent", rules: [{ toolKey: "track_order", mode: "ALWAYS", phrases: ["where is my order", "track my order"] }], forcedTool: "track_order" });
  });

  it("a failed action is explained and the chat is handed to a human", async () => {
    const sessionId = await newSession();
    const model = scripted("scripted/fail", (messages) => {
      const results = toolResults(messages);
      return results.length ? new AIMessage("Sorry, I couldn't check your order right now.") : call("track_order", { order_number: "1042", reason: "Customer asked for the order status" });
    });
    const result = await runAgentReply(await input(sessionId, "where is order 1042", [model]));
    expect(result.reply).toContain("couldn't");

    const execution = await prisma.toolExecution.findFirstOrThrow({ where: { runId: result.runId, toolKey: "track_order" } });
    expect(execution.status).toBe("ERROR");
    expect(execution.error).toContain("HTTP 503");

    const session = await prisma.chatSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe("ESCALATED");
    const escalation = await prisma.toolExecution.findFirstOrThrow({ where: { runId: result.runId, toolKey: "escalate_to_human" } });
    expect(escalation).toMatchObject({ status: "SUCCESS", triggeredBy: "RULE" });
    const trace = parseRunTrace((await prisma.agentRun.findUniqueOrThrow({ where: { id: result.runId } })).trace);
    expect(trace.at(-1)).toMatchObject({ type: "escalation", reason: expect.stringContaining("track_order failed") });
  });
});
