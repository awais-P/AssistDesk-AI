import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildModelChain } from "@/src/lib/agent-engine/model-chain";
import { runAgentReply } from "@/src/lib/agent-engine/run-agent";
import { prisma } from "@/src/lib/prisma";
import { ensureBuiltInTools, loadAgentToolset } from "@/src/lib/tools/registry";

/**
 * Module 2 smoke test with a REAL model (uses provider quota). Skipped unless
 * RUN_REAL_LLM=1 and a managed key (ASSISTDESK_DEFAULT_*_API_KEY) is set.
 */
const enabled = process.env.RUN_REAL_LLM === "1";
const suffix = Date.now().toString(36);
let workspaceId = "";
let agentId = "";
let contactId = "";

describe.skipIf(!enabled)("real model tool calling", () => {
  beforeAll(async () => {
    const workspace = await prisma.workspace.create({ data: { name: `M2 real ${suffix}`, slug: `m2-real-${suffix}`, supportEmail: `real-${suffix}@example.com` } });
    workspaceId = workspace.id;
    const inbox = await prisma.inbox.create({ data: { workspaceId, name: "Support", emailPrefix: `real-${suffix}`, ticketPrefix: "RL" } });
    agentId = (await prisma.aIAgent.create({ data: { workspaceId, name: "Real agent", provider: "Default", model: process.env.REAL_LLM_MODEL ?? "groq/llama-3.3-70b-versatile", status: "ACTIVE", toolsEnabled: true } })).id;
    contactId = (await prisma.contact.create({ data: { workspaceId, name: "Ayesha Khan", email: "ayesha@example.com" } })).id;
    await prisma.ticket.create({ data: { workspaceId, inboxId: inbox.id, ticketNumber: 800123, subject: "Kettle replacement", status: "IN_PROGRESS", contactId } });
    await ensureBuiltInTools(workspaceId);
    const tools = await prisma.agentTool.findMany({ where: { workspaceId } });
    await prisma.agentToolBinding.createMany({ data: tools.map((tool) => ({ agentId, toolId: tool.id })) });
  });

  afterAll(async () => {
    if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.$disconnect();
  });

  it("calls lookup_ticket_status and answers from its result", async () => {
    const sessionId = (await prisma.chatSession.create({ data: { workspaceId, channel: "WEB_WIDGET", contactId } })).id;
    const { tools, settings } = await loadAgentToolset(workspaceId, agentId);
    const agent = { id: agentId, provider: "Default", model: process.env.REAL_LLM_MODEL ?? "groq/llama-3.3-70b-versatile", apiKey: null, systemPrompt: "You are a support assistant.", confidenceThreshold: 0.5, temperature: 0.2 };
    console.log("model chain:", buildModelChain(agent).map((model) => model.id).join(" → "));

    const result = await runAgentReply({
      agent,
      workspaceId,
      channel: "WEB_WIDGET",
      source: "CHAT",
      question: "Hi, what's the status of my ticket RL-800123?",
      history: [],
      sources: [],
      tools,
      settings: settings!,
      ctx: {
        workspaceId,
        sessionId,
        ticketId: null,
        contactId,
        channel: "WEB_WIDGET",
        verifiedIdentity: true,
        customer: { name: "Ayesha Khan", email: "ayesha@example.com", phone: null },
        timeZone: "Asia/Karachi",
        dryRun: false,
        triggeredBy: "MODEL",
      },
    });

    console.log("status:", result.status, "model:", result.modelUsed, "tool calls:", result.toolCalls);
    console.log("trace:", JSON.stringify(result.trace).slice(0, 1200));
    console.log("reply:", result.reply);
    expect(result.trace.some((entry) => entry.type === "tool" && entry.toolKey === "lookup_ticket_status")).toBe(true);
    expect(result.reply.toLowerCase()).toMatch(/progress|being worked|in progress/);
  });
});
