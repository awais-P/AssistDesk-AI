import type { Prisma } from "@/app/generated/prisma/client";
import { parseRunTrace, traceExecutionIds } from "./agent-engine/run-trace";
import { prisma } from "./prisma";
import { CONFIRMATION_TTL_MS } from "./tools/registry";

/**
 * Module 2 FE-5 Action Logs (SRS UI-4: paginated, filterable, sortable): reasoning runs
 * with their chain of thought, and the individual actions they took.
 */

export const ACTION_LOG_PAGE_SIZE = 25;
export const RUN_STATUSES = ["COMPLETED", "AWAITING_CONFIRMATION", "MAX_STEPS", "FALLBACK", "FAILED", "RUNNING"] as const;
export const RUN_SOURCES = ["CHAT", "EMAIL", "PLAYGROUND"] as const;
export const EXECUTION_STATUSES = ["SUCCESS", "ERROR", "DENIED", "PENDING_CONFIRMATION", "CANCELLED"] as const;
export const TRIGGERS = ["MODEL", "RULE", "CONFIRMATION", "TEST"] as const;
export const RUN_SORTS = ["newest", "oldest", "slowest", "most_actions"] as const;
export const EXECUTION_SORTS = ["newest", "oldest", "slowest"] as const;

export type ActionLogFilters = {
  view: "runs" | "actions";
  status: string;
  source: string;
  agentId: string;
  tool: string;
  trigger: string;
  q: string;
  /** Only this conversation or ticket (Chats / ticket side panels). */
  sessionId: string;
  ticketId: string;
  from: Date | null;
  to: Date | null;
  sort: string;
  page: number;
};

function pick<T extends readonly string[]>(value: string | null, options: T): T[number] | "" {
  return value && (options as readonly string[]).includes(value) ? (value as T[number]) : "";
}

function parseDay(value: string | null, endOfDay: boolean) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseActionLogFilters(params: URLSearchParams): ActionLogFilters {
  const view = params.get("view") === "actions" ? "actions" : "runs";

  return {
    view,
    status: view === "runs" ? pick(params.get("status"), RUN_STATUSES) : pick(params.get("status"), EXECUTION_STATUSES),
    source: pick(params.get("source"), RUN_SOURCES),
    agentId: (params.get("agent") ?? "").slice(0, 40),
    tool: /^[a-z][a-z0-9_]{1,39}$/.test(params.get("tool") ?? "") ? (params.get("tool") as string) : "",
    trigger: pick(params.get("trigger"), TRIGGERS),
    q: (params.get("q") ?? "").trim().slice(0, 120),
    sessionId: /^[A-Za-z0-9_-]{1,40}$/.test(params.get("session") ?? "") ? (params.get("session") as string) : "",
    ticketId: /^[A-Za-z0-9_-]{1,40}$/.test(params.get("ticket") ?? "") ? (params.get("ticket") as string) : "",
    from: parseDay(params.get("from"), false),
    to: parseDay(params.get("to"), true),
    sort: view === "runs" ? pick(params.get("sort"), RUN_SORTS) || "newest" : pick(params.get("sort"), EXECUTION_SORTS) || "newest",
    page: Math.max(1, Math.min(1000, Math.floor(Number(params.get("page")) || 1))),
  };
}

function dateRange(filters: ActionLogFilters) {
  if (!filters.from && !filters.to) return undefined;
  return { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) };
}

export async function listAgentRuns(workspaceId: string, filters: ActionLogFilters) {
  const where: Prisma.AgentRunWhereInput = { workspaceId };
  if (filters.status) where.status = filters.status;
  if (filters.source) where.source = filters.source;
  if (filters.agentId) where.agentId = filters.agentId;
  if (filters.sessionId) where.sessionId = filters.sessionId;
  if (filters.ticketId) where.ticketId = filters.ticketId;
  if (filters.tool) where.executions = { some: { toolKey: filters.tool } };
  if (filters.q) where.OR = [{ question: { contains: filters.q, mode: "insensitive" } }, { answer: { contains: filters.q, mode: "insensitive" } }];
  const createdAt = dateRange(filters);
  if (createdAt) where.createdAt = createdAt;

  const orderBy: Prisma.AgentRunOrderByWithRelationInput[] =
    filters.sort === "oldest"
      ? [{ createdAt: "asc" }]
      : filters.sort === "slowest"
        ? [{ latencyMs: "desc" }, { createdAt: "desc" }]
        : filters.sort === "most_actions"
          ? [{ toolCalls: "desc" }, { createdAt: "desc" }]
          : [{ createdAt: "desc" }];

  const [total, rows] = await Promise.all([
    prisma.agentRun.count({ where }),
    prisma.agentRun.findMany({
      where,
      orderBy,
      skip: (filters.page - 1) * ACTION_LOG_PAGE_SIZE,
      take: ACTION_LOG_PAGE_SIZE,
      select: {
        id: true,
        source: true,
        channel: true,
        question: true,
        answer: true,
        status: true,
        steps: true,
        toolCalls: true,
        model: true,
        latencyMs: true,
        error: true,
        createdAt: true,
        sessionId: true,
        ticketId: true,
        agent: { select: { id: true, name: true } },
        ticket: { select: { ticketNumber: true, inbox: { select: { ticketPrefix: true } } } },
        executions: { select: { toolName: true, status: true }, orderBy: { createdAt: "asc" }, take: 8 },
      },
    }),
  ]);

  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      source: row.source,
      channel: row.channel,
      question: row.question,
      answer: row.answer,
      status: row.status,
      steps: row.steps,
      toolCalls: row.toolCalls,
      model: row.model,
      latencyMs: row.latencyMs,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      sessionId: row.sessionId,
      ticketId: row.ticketId,
      ticketReference: row.ticket ? `${row.ticket.inbox?.ticketPrefix ?? "AD"}-${row.ticket.ticketNumber}` : null,
      agent: row.agent,
      actions: row.executions,
    })),
  };
}

export async function listToolExecutions(workspaceId: string, filters: ActionLogFilters) {
  const where: Prisma.ToolExecutionWhereInput = { workspaceId };
  if (filters.status) where.status = filters.status as (typeof EXECUTION_STATUSES)[number];
  if (filters.agentId) where.agentId = filters.agentId;
  if (filters.tool) where.toolKey = filters.tool;
  if (filters.sessionId) where.sessionId = filters.sessionId;
  if (filters.ticketId) where.ticketId = filters.ticketId;
  if (filters.trigger) where.triggeredBy = filters.trigger;
  if (filters.source) where.run = { source: filters.source };
  if (filters.q) where.OR = [{ reasoning: { contains: filters.q, mode: "insensitive" } }, { toolName: { contains: filters.q, mode: "insensitive" } }, { error: { contains: filters.q, mode: "insensitive" } }];
  const createdAt = dateRange(filters);
  if (createdAt) where.createdAt = createdAt;

  const orderBy: Prisma.ToolExecutionOrderByWithRelationInput[] =
    filters.sort === "oldest" ? [{ createdAt: "asc" }] : filters.sort === "slowest" ? [{ latencyMs: "desc" }, { createdAt: "desc" }] : [{ createdAt: "desc" }];

  const [total, rows] = await Promise.all([
    prisma.toolExecution.count({ where }),
    prisma.toolExecution.findMany({
      where,
      orderBy,
      skip: (filters.page - 1) * ACTION_LOG_PAGE_SIZE,
      take: ACTION_LOG_PAGE_SIZE,
      include: { agent: { select: { id: true, name: true } }, run: { select: { source: true, question: true } } },
    }),
  ]);

  return { total, rows: rows.map(serializeExecution) };
}

type ExecutionRow = Prisma.ToolExecutionGetPayload<{ include: { agent: { select: { id: true; name: true } }; run: { select: { source: true; question: true } } } }>;

export function serializeExecution(row: ExecutionRow) {
  return {
    id: row.id,
    runId: row.runId,
    toolKey: row.toolKey,
    toolName: row.toolName,
    step: row.step,
    reasoning: row.reasoning,
    input: row.input,
    output: row.output,
    status: row.status,
    error: row.error,
    latencyMs: row.latencyMs,
    triggeredBy: row.triggeredBy,
    dryRun: row.dryRun,
    sessionId: row.sessionId,
    ticketId: row.ticketId,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    agent: row.agent,
    source: row.run?.source ?? (row.triggeredBy === "TEST" ? "TEST" : null),
    question: row.run?.question ?? null,
  };
}

export type SerializedExecution = ReturnType<typeof serializeExecution>;

/** One run with its chain of thought and every action it refers to. */
export async function getAgentRunDetail(workspaceId: string, runId: string) {
  const run = await prisma.agentRun.findFirst({
    where: { id: runId, workspaceId },
    include: {
      agent: { select: { id: true, name: true } },
      ticket: { select: { ticketNumber: true, subject: true, inbox: { select: { ticketPrefix: true } } } },
      session: { select: { id: true, customerName: true, customerEmail: true, contact: { select: { id: true, name: true } } } },
    },
  });

  if (!run) {
    return null;
  }

  const trace = parseRunTrace(run.trace);
  const ids = traceExecutionIds(trace);
  const executions = await prisma.toolExecution.findMany({
    // Its own actions, plus a confirmed action that an earlier run proposed (or vice versa).
    where: { workspaceId, OR: [{ runId: run.id }, ...(ids.length ? [{ id: { in: ids } }] : [])] },
    include: { agent: { select: { id: true, name: true } }, run: { select: { source: true, question: true } } },
    orderBy: { createdAt: "asc" },
  });

  return {
    id: run.id,
    source: run.source,
    channel: run.channel,
    question: run.question,
    answer: run.answer,
    status: run.status,
    steps: run.steps,
    toolCalls: run.toolCalls,
    model: run.model,
    latencyMs: run.latencyMs,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    agent: run.agent,
    sessionId: run.sessionId,
    ticketId: run.ticketId,
    ticket: run.ticket ? { reference: `${run.ticket.inbox?.ticketPrefix ?? "AD"}-${run.ticket.ticketNumber}`, subject: run.ticket.subject } : null,
    customer: run.session ? { name: run.session.contact?.name ?? run.session.customerName, email: run.session.customerEmail, contactId: run.session.contact?.id ?? null } : null,
    trace,
    executions: executions.map(serializeExecution),
  };
}

export type AgentRunDetail = NonNullable<Awaited<ReturnType<typeof getAgentRunDetail>>>;

/** Headline numbers for the Action Logs (last 30 days unless a range is chosen). */
export async function actionLogSummary(workspaceId: string, filters: Pick<ActionLogFilters, "from" | "to">) {
  const createdAt = dateRange({ ...filters } as ActionLogFilters) ?? { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
  const [runs, executions, awaiting] = await Promise.all([
    prisma.agentRun.groupBy({ by: ["status"], where: { workspaceId, createdAt, source: { not: "PLAYGROUND" } }, _count: { _all: true } }),
    prisma.toolExecution.groupBy({
      by: ["status"],
      where: { workspaceId, createdAt, triggeredBy: { not: "TEST" }, dryRun: false, NOT: { run: { is: { source: "PLAYGROUND" } } } },
      _count: { _all: true },
    }),
    // Only ones still inside the confirmation window (older ones are expired by the cron).
    prisma.toolExecution.count({ where: { workspaceId, status: "PENDING_CONFIRMATION", createdAt: { gte: new Date(Date.now() - CONFIRMATION_TTL_MS) } } }),
  ]);
  const count = (groups: Array<{ status: string; _count: { _all: number } }>, status?: string) =>
    groups.filter((group) => !status || group.status === status).reduce((sum, group) => sum + group._count._all, 0);
  const finished = count(executions, "SUCCESS") + count(executions, "ERROR");

  return {
    runs: count(runs),
    actions: count(executions),
    successRate: finished ? Math.round((count(executions, "SUCCESS") / finished) * 100) : null,
    failedActions: count(executions, "ERROR"),
    fallbacks: count(runs, "FALLBACK") + count(runs, "FAILED"),
    awaitingConfirmation: awaiting,
  };
}
