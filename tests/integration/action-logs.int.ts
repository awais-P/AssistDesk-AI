import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Module 2 increment 4 (FE-5, SRS UI-4): the Action Logs API — runs and actions,
 * filters, sorting, pagination, one run's chain of thought, workspace isolation.
 */

const signedIn: { current: { user: { id: string; role: string; workspaceId: string } } | null } = { current: null };
vi.mock("@/src/lib/auth", () => ({ getCurrentSession: async () => signedIn.current }));

const list = await import("@/app/api/action-logs/route");
const detail = await import("@/app/api/action-logs/runs/[id]/route");

const suffix = Date.now().toString(36);
let workspaceId = "";
let otherWorkspaceId = "";
let agentId = "";
let sessionId = "";
const runIds: Record<string, string> = {};
const executionIds: Record<string, string> = {};

async function get(query: string) {
  const response = await list.GET(new Request(`http://localhost/api/action-logs?${query}`));
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  workspaceId = (await prisma.workspace.create({ data: { name: `M2 logs ${suffix}`, slug: `m2-logs-${suffix}`, supportEmail: `logs-${suffix}@example.com` } })).id;
  otherWorkspaceId = (await prisma.workspace.create({ data: { name: `M2 other ${suffix}`, slug: `m2-logs-other-${suffix}`, supportEmail: `logs-other-${suffix}@example.com` } })).id;
  agentId = (await prisma.aIAgent.create({ data: { workspaceId, name: "Ops agent", provider: "Default", model: "groq/llama-3.3-70b-versatile", status: "ACTIVE" } })).id;
  sessionId = (await prisma.chatSession.create({ data: { workspaceId, channel: "WEB_WIDGET" } })).id;
  const otherSession = (await prisma.chatSession.create({ data: { workspaceId, channel: "WHATSAPP" } })).id;
  const base = Date.now() - 60 * 60_000;

  // Run 1: proposed a booking (waiting for yes).
  runIds.propose = (
    await prisma.agentRun.create({
      data: { workspaceId, agentId, sessionId, channel: "WEB_WIDGET", source: "CHAT", question: "Book me for Monday 9am", answer: "Shall I book Mon 09:00?", status: "AWAITING_CONFIRMATION", steps: 2, toolCalls: 2, latencyMs: 900, createdAt: new Date(base) },
    })
  ).id;
  executionIds.slots = (
    await prisma.toolExecution.create({
      data: { workspaceId, runId: runIds.propose, agentId, sessionId, toolKey: "check_availability", toolName: "Check appointment availability", step: 1, reasoning: "Find free slots", input: {}, output: { slots: [] }, status: "SUCCESS", latencyMs: 40, createdAt: new Date(base + 1000) },
    })
  ).id;
  executionIds.book = (
    await prisma.toolExecution.create({
      data: { workspaceId, runId: runIds.propose, agentId, sessionId, toolKey: "book_appointment", toolName: "Book appointment", step: 2, reasoning: "Customer chose Monday", input: { starts_at: "x" }, status: "PENDING_CONFIRMATION", createdAt: new Date(base + 2000) },
    })
  ).id;
  await prisma.agentRun.update({
    where: { id: runIds.propose },
    data: {
      trace: [
        { type: "tool", step: 1, toolKey: "check_availability", toolName: "Check appointment availability", status: "SUCCESS", reason: "Find free slots", executionId: executionIds.slots },
        { type: "tool", step: 2, toolKey: "book_appointment", toolName: "Book appointment", status: "PENDING_CONFIRMATION", reason: "Customer chose Monday", executionId: executionIds.book },
      ],
    },
  });

  // Run 2: the customer said yes; the booking ran and moved to this run.
  runIds.confirm = (
    await prisma.agentRun.create({
      data: { workspaceId, agentId, sessionId, channel: "WEB_WIDGET", source: "CHAT", question: "yes please", answer: "Booked!", status: "COMPLETED", steps: 1, toolCalls: 0, latencyMs: 300, createdAt: new Date(base + 60_000) },
    })
  ).id;
  await prisma.toolExecution.update({ where: { id: executionIds.book }, data: { status: "SUCCESS", triggeredBy: "CONFIRMATION", runId: runIds.confirm, latencyMs: 120, resolvedAt: new Date() } });
  await prisma.agentRun.update({
    where: { id: runIds.confirm },
    data: { trace: [{ type: "confirmation", state: "EXECUTED", status: "SUCCESS", toolName: "Book appointment", summary: "Book Mon 09:00", executionId: executionIds.book }] },
  });

  // Run 3: a slow WhatsApp failure that fell back.
  runIds.failed = (
    await prisma.agentRun.create({
      data: { workspaceId, agentId, sessionId: otherSession, channel: "WHATSAPP", source: "CHAT", question: "Where is order 1042?", answer: "Sorry…", status: "FALLBACK", steps: 1, toolCalls: 1, latencyMs: 8000, createdAt: new Date(base + 120_000) },
    })
  ).id;
  executionIds.track = (
    await prisma.toolExecution.create({
      data: { workspaceId, runId: runIds.failed, agentId, sessionId: otherSession, toolKey: "track_order", toolName: "Track order", step: 1, reasoning: "Customer asked about 1042", input: { order_number: "1042" }, status: "ERROR", error: "HTTP 503", latencyMs: 5000, createdAt: new Date(base + 121_000) },
    })
  ).id;

  // A Playground run and an admin test (no run).
  await prisma.agentRun.create({ data: { workspaceId, agentId, channel: "WEB_WIDGET", source: "PLAYGROUND", question: "test", status: "COMPLETED", createdAt: new Date(base + 180_000) } });
  await prisma.toolExecution.create({ data: { workspaceId, toolKey: "track_order", toolName: "Track order", input: { order_number: "1" }, status: "SUCCESS", triggeredBy: "TEST", latencyMs: 30 } });

  // Another workspace's run must never show up.
  runIds.foreign = (await prisma.agentRun.create({ data: { workspaceId: otherWorkspaceId, channel: "WEB_WIDGET", source: "CHAT", question: "secret", status: "COMPLETED" } })).id;
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId].filter(Boolean) } } });
  await prisma.$disconnect();
});

describe("action logs API", () => {
  it("needs a signed-in user", async () => {
    signedIn.current = null;
    expect((await get("")).status).toBe(401);
    expect((await detail.GET(new Request("http://localhost"), { params: Promise.resolve({ id: runIds.propose }) })).status).toBe(401);
  });

  it("lists runs newest first with their actions and a summary", async () => {
    signedIn.current = { user: { id: "u", role: "AGENT", workspaceId } };
    const { body } = await get("");
    expect(body.total).toBe(4);
    expect(body.rows[0].source).toBe("PLAYGROUND");
    expect(body.rows.map((row: { id: string }) => row.id)).not.toContain(runIds.foreign);
    const propose = body.rows.find((row: { id: string }) => row.id === runIds.propose);
    expect(propose.actions.map((action: { toolName: string }) => action.toolName)).toEqual(["Check appointment availability"]);
    // Summary excludes the Playground run and the admin test.
    expect(body.summary).toMatchObject({ runs: 3, actions: 3, failedActions: 1, fallbacks: 1, awaitingConfirmation: 0 });
    expect(body.summary.successRate).toBe(67);
    expect(body.options.tools.map((tool: { key: string }) => tool.key)).toEqual(["book_appointment", "check_availability", "track_order"]);
  });

  it("filters and sorts runs (UI-4)", async () => {
    expect((await get("status=FALLBACK")).body.rows.map((row: { id: string }) => row.id)).toEqual([runIds.failed]);
    expect((await get("source=PLAYGROUND")).body.total).toBe(1);
    expect((await get("tool=book_appointment")).body.rows.map((row: { id: string }) => row.id)).toEqual([runIds.confirm]);
    expect((await get(`session=${sessionId}&sort=oldest`)).body.rows.map((row: { id: string }) => row.id)).toEqual([runIds.propose, runIds.confirm]);
    expect((await get("q=ORDER%201042")).body.rows.map((row: { id: string }) => row.id)).toEqual([runIds.failed]);
    expect((await get("sort=slowest")).body.rows[0].id).toBe(runIds.failed);
    expect((await get("sort=most_actions")).body.rows[0].id).toBe(runIds.propose);
    // Unknown values are ignored instead of failing.
    expect((await get("status=DROP_TABLE&sort=evil&page=-4")).body.total).toBe(4);
    expect((await get("page=2")).body.rows).toEqual([]);
  });

  it("lists individual actions with trigger, source and status filters", async () => {
    const all = await get("view=actions");
    expect(all.body.total).toBe(4);
    expect((await get("view=actions&trigger=TEST")).body.rows[0]).toMatchObject({ source: "TEST", runId: null });
    expect((await get("view=actions&trigger=CONFIRMATION")).body.rows.map((row: { id: string }) => row.id)).toEqual([executionIds.book]);
    expect((await get("view=actions&status=ERROR")).body.rows[0]).toMatchObject({ toolKey: "track_order", error: "HTTP 503", question: "Where is order 1042?" });
    expect((await get("view=actions&source=CHAT&sort=slowest")).body.rows[0].id).toBe(executionIds.track);
    expect((await get(`view=actions&session=${sessionId}`)).body.total).toBe(2);
  });

  it("returns a run's chain of thought, including an action confirmed in a later run", async () => {
    const response = await detail.GET(new Request("http://localhost"), { params: Promise.resolve({ id: runIds.propose }) });
    const { run } = await response.json();
    expect(run.trace).toHaveLength(2);
    // The booking now belongs to the confirming run but is still shown where it was proposed.
    expect(run.executions.map((execution: { id: string; status: string }) => [execution.id, execution.status])).toEqual([
      [executionIds.slots, "SUCCESS"],
      [executionIds.book, "SUCCESS"],
    ]);

    const confirm = await (await detail.GET(new Request("http://localhost"), { params: Promise.resolve({ id: runIds.confirm }) })).json();
    expect(confirm.run.trace[0]).toMatchObject({ type: "confirmation", executionId: executionIds.book });
    expect(confirm.run.executions.map((execution: { id: string }) => execution.id)).toEqual([executionIds.book]);
  });

  it("keeps other workspaces' runs private", async () => {
    expect((await detail.GET(new Request("http://localhost"), { params: Promise.resolve({ id: runIds.foreign }) })).status).toBe(404);
  });
});
