import type { AgentTool, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "../prisma";
import { BUILT_IN_BY_KEY, BUILT_IN_TOOLS, type BuiltInDefinition, type ToolContext, ToolError } from "./builtin-tools";
import { type HttpToolConfig, executeHttpTool } from "./http-tool";
import {
  type ToolInputValues,
  type ToolParameter,
  detectConfirmation,
  parseToolParameters,
  trimForModel,
  validateToolInput,
} from "./tool-schema";

/**
 * Module 2 tool registry (FE-1, FE-2b, FE-3): which tools exist, which an agent may
 * use, and how a call is validated, confirmed, executed and logged (FE-5).
 *
 * Confirmation: tools marked "requires confirmation" never run on the model's word.
 * The call is stored as PENDING_CONFIRMATION and the model must ask the customer; the
 * customer's next message ("yes" / "no") runs or cancels it on the server.
 */

export const CONFIRMATION_TTL_MS = 30 * 60 * 1000;

export type RuntimeTool = {
  id: string;
  key: string;
  name: string;
  description: string;
  type: "BUILT_IN" | "HTTP";
  parameters: ToolParameter[];
  requiresConfirmation: boolean;
  effect: "READ" | "WRITE";
  builtIn: BuiltInDefinition | null;
  http: HttpToolConfig | null;
};

/** Creates any built-in tools a workspace does not have yet (idempotent). */
export async function ensureBuiltInTools(workspaceId: string) {
  const existing = await prisma.agentTool.findMany({
    where: { workspaceId, type: "BUILT_IN" },
    select: { builtInKey: true },
  });
  const have = new Set(existing.map((tool) => tool.builtInKey));
  const missing = BUILT_IN_TOOLS.filter((tool) => !have.has(tool.key));

  if (missing.length > 0) {
    await prisma.agentTool.createMany({
      data: missing.map((tool) => ({
        workspaceId,
        key: tool.key,
        name: tool.name,
        description: tool.description,
        type: "BUILT_IN" as const,
        builtInKey: tool.key,
        parameters: tool.parameters as unknown as Prisma.InputJsonValue,
        requiresConfirmation: tool.requiresConfirmation,
      })),
      skipDuplicates: true,
    });
  }
}

export function toRuntimeTool(row: AgentTool): RuntimeTool | null {
  if (row.type === "BUILT_IN") {
    const builtIn = row.builtInKey ? BUILT_IN_BY_KEY.get(row.builtInKey) : undefined;

    if (!builtIn) {
      return null;
    }

    return {
      id: row.id,
      key: row.key,
      name: row.name || builtIn.name,
      description: row.description?.trim() || builtIn.description,
      type: "BUILT_IN",
      // Parameters of built-ins always come from the code.
      parameters: builtIn.parameters,
      requiresConfirmation: row.requiresConfirmation,
      effect: builtIn.effect,
      builtIn,
      http: null,
    };
  }

  if (!row.httpUrl) {
    return null;
  }

  const method = (row.httpMethod ?? "GET").toUpperCase();

  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    type: "HTTP",
    parameters: parseToolParameters(row.parameters),
    requiresConfirmation: row.requiresConfirmation,
    effect: method === "GET" ? "READ" : "WRITE",
    builtIn: null,
    http: {
      name: row.name,
      httpMethod: method,
      httpUrl: row.httpUrl,
      httpHeaders: row.httpHeaders,
      httpBody: row.httpBody,
      httpTimeoutMs: row.httpTimeoutMs,
      responseFields: row.responseFields,
    },
  };
}

/** The tools an agent may call right now (agent switch on, bound, tool enabled). */
export async function loadAgentToolset(workspaceId: string, agentId: string) {
  const agent = await prisma.aIAgent.findFirst({
    where: { id: agentId, workspaceId },
    select: {
      toolsEnabled: true,
      maxToolSteps: true,
      escalateOnToolFailure: true,
      intentRules: true,
      toolBindings: { select: { tool: true } },
    },
  });

  if (!agent?.toolsEnabled) {
    return { tools: [] as RuntimeTool[], settings: null };
  }

  const tools = agent.toolBindings
    .map((binding) => binding.tool)
    .filter((tool) => tool.isEnabled)
    .map(toRuntimeTool)
    .filter((tool): tool is RuntimeTool => Boolean(tool));

  return {
    tools,
    settings: {
      maxToolSteps: Math.min(8, Math.max(1, agent.maxToolSteps)),
      escalateOnToolFailure: agent.escalateOnToolFailure,
      intentRules: agent.intentRules,
    },
  };
}

function summarize(tool: RuntimeTool, values: ToolInputValues, ctx: ToolContext) {
  if (tool.builtIn) {
    return tool.builtIn.summarize(values, ctx);
  }

  const shown = Object.entries(values)
    .slice(0, 4)
    .map(([name, value]) => `${name}=${String(value).slice(0, 40)}`)
    .join(", ");
  return `${tool.name}${shown ? ` (${shown})` : ""}`;
}

export type ToolRunResult = {
  executionId: string | null;
  status: "SUCCESS" | "ERROR" | "PENDING_CONFIRMATION" | "DENIED";
  /** What the model sees as the tool result. */
  output: unknown;
  summary: string;
};

async function logExecution(
  tool: RuntimeTool,
  ctx: ToolContext,
  data: {
    input: unknown;
    output?: unknown;
    status: "SUCCESS" | "ERROR" | "PENDING_CONFIRMATION" | "DENIED" | "CANCELLED";
    error?: string | null;
    latencyMs?: number;
    reasoning?: string | null;
  },
) {
  const row = await prisma.toolExecution.create({
    data: {
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      agentId: ctx.agentId,
      // Built-ins run automatically (e.g. escalation on failure) may have no registry row.
      toolId: tool.id || null,
      toolKey: tool.key,
      toolName: tool.name,
      sessionId: ctx.sessionId,
      ticketId: ctx.ticketId,
      step: ctx.step,
      reasoning: data.reasoning ?? null,
      input: (data.input ?? {}) as Prisma.InputJsonValue,
      output: data.output === undefined ? undefined : (trimForModel(data.output) as Prisma.InputJsonValue),
      status: data.status,
      error: data.error ?? null,
      latencyMs: Math.round(data.latencyMs ?? 0),
      triggeredBy: ctx.triggeredBy,
      // Only actions that were really simulated count as test mode; lookups run for real.
      dryRun: ctx.dryRun && tool.effect === "WRITE",
    },
    select: { id: true },
  });
  return row.id;
}

async function execute(tool: RuntimeTool, values: ToolInputValues, ctx: ToolContext) {
  const startedAt = Date.now();

  try {
    if (tool.builtIn) {
      // Built-in writes handle dry runs themselves (they describe what would happen).
      return { ok: true as const, output: await tool.builtIn.execute(values, ctx), latencyMs: Date.now() - startedAt };
    }

    const result = await executeHttpTool(tool.http as HttpToolConfig, values, { dryRun: ctx.dryRun });
    return result.ok
      ? { ok: true as const, output: result.data, latencyMs: Date.now() - startedAt }
      : { ok: false as const, error: result.error, latencyMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof ToolError) {
      return { ok: false as const, error: error.message, latencyMs: Date.now() - startedAt };
    }

    console.error(`[tools] ${tool.key} failed:`, error);
    return { ok: false as const, error: "The action failed because of an internal error.", latencyMs: Date.now() - startedAt };
  }
}

/** Validates, confirms (when required), executes and logs one tool call. */
export async function runTool({ tool, rawInput, ctx }: { tool: RuntimeTool; rawInput: unknown; ctx: ToolContext }): Promise<ToolRunResult> {
  const validation = validateToolInput(tool.parameters, rawInput);

  if (!validation.ok) {
    const error = `Invalid input: ${validation.errors.join(" ")}`;
    const executionId = await logExecution(tool, ctx, { input: rawInput, status: "ERROR", error });
    return { executionId, status: "ERROR", output: { error, hint: "Ask the customer for the missing details, then call the tool again." }, summary: tool.name };
  }

  const { values, reason } = validation;
  const summary = summarize(tool, values, ctx);

  if (tool.requiresConfirmation && !ctx.dryRun && ctx.triggeredBy !== "CONFIRMATION" && ctx.triggeredBy !== "TEST") {
    // The assistant already asked and the customer just said yes: don't ask twice.
    if (ctx.sessionId && ctx.customerConsent && !ctx.customerConsent.used) {
      ctx.customerConsent.used = true;
      const confirmedCtx: ToolContext = { ...ctx, triggeredBy: "CONFIRMATION" };
      const result = await execute(tool, values, confirmedCtx);
      const executionId = await logExecution(tool, confirmedCtx, {
        input: values,
        output: result.ok ? result.output : undefined,
        status: result.ok ? "SUCCESS" : "ERROR",
        error: result.ok ? null : result.error,
        latencyMs: result.latencyMs,
        reasoning: `${reason ?? "Customer request"} — confirmed by the customer's reply: "${ctx.customerConsent.message.slice(0, 120)}"`,
      });

      return {
        executionId,
        status: result.ok ? "SUCCESS" : "ERROR",
        output: result.ok ? trimForModel(result.output) : { error: result.error },
        summary,
      };
    }

    if (!ctx.sessionId) {
      // No conversation to confirm in (e.g. email): refuse rather than act unconfirmed.
      const executionId = await logExecution(tool, ctx, { input: values, status: "DENIED", error: "Needs confirmation, which is only possible in a chat.", reasoning: reason });
      return { executionId, status: "DENIED", output: { error: "This action needs the customer's confirmation in a chat. Offer to arrange it with the team instead." }, summary };
    }

    // One pending action per conversation: a newer request replaces the older one.
    await prisma.toolExecution.updateMany({
      where: { sessionId: ctx.sessionId, status: "PENDING_CONFIRMATION" },
      data: { status: "CANCELLED", resolvedAt: new Date(), error: "Replaced by a newer request." },
    });
    const executionId = await logExecution(tool, ctx, { input: values, output: { awaiting: summary }, status: "PENDING_CONFIRMATION", reasoning: reason });

    return {
      executionId,
      status: "PENDING_CONFIRMATION",
      output: {
        status: "needs_customer_confirmation",
        instruction: `Do not say it is done. Ask the customer to confirm: "${summary}. Shall I go ahead?" It will run when they reply yes.`,
      },
      summary,
    };
  }

  const result = await execute(tool, values, ctx);
  const executionId = await logExecution(tool, ctx, {
    input: values,
    output: result.ok ? result.output : undefined,
    status: result.ok ? "SUCCESS" : "ERROR",
    error: result.ok ? null : result.error,
    latencyMs: result.latencyMs,
    reasoning: reason,
  });

  return {
    executionId,
    status: result.ok ? "SUCCESS" : "ERROR",
    output: result.ok ? trimForModel(result.output) : { error: result.error },
    summary,
  };
}

export type ConfirmationOutcome =
  | { state: "NONE" }
  | { state: "STILL_PENDING"; summary: string; toolName: string; executionId: string }
  | { state: "CANCELLED"; summary: string; toolName: string; executionId: string }
  | { state: "EXECUTED"; summary: string; toolName: string; toolKey: string; executionId: string; status: "SUCCESS" | "ERROR"; output: unknown };

/**
 * Before the AI answers a new customer message: if an action is waiting for this
 * customer's confirmation, their reply decides it. Runs on the server, so a model
 * cannot skip the confirmation.
 */
export async function resolvePendingConfirmation({
  message,
  ctx,
}: {
  message: string;
  ctx: ToolContext;
}): Promise<ConfirmationOutcome> {
  if (!ctx.sessionId) {
    return { state: "NONE" };
  }

  const pending = await prisma.toolExecution.findFirst({
    where: { sessionId: ctx.sessionId, workspaceId: ctx.workspaceId, status: "PENDING_CONFIRMATION" },
    orderBy: { createdAt: "desc" },
    include: { tool: true },
  });

  if (!pending) {
    return { state: "NONE" };
  }

  const summary = (pending.output as { awaiting?: string } | null)?.awaiting ?? pending.toolName;

  if (Date.now() - pending.createdAt.getTime() > CONFIRMATION_TTL_MS || !pending.tool) {
    await prisma.toolExecution.update({
      where: { id: pending.id },
      data: { status: "CANCELLED", resolvedAt: new Date(), error: pending.tool ? "Confirmation expired." : "The tool was removed." },
    });
    return { state: "NONE" };
  }

  const decision = detectConfirmation(message);

  if (decision === null) {
    return { state: "STILL_PENDING", summary, toolName: pending.toolName, executionId: pending.id };
  }

  if (decision === "NO") {
    await prisma.toolExecution.update({
      where: { id: pending.id },
      data: { status: "CANCELLED", resolvedAt: new Date(), error: "The customer said no." },
    });
    return { state: "CANCELLED", summary, toolName: pending.toolName, executionId: pending.id };
  }

  const tool = toRuntimeTool(pending.tool);

  if (!tool || !pending.tool.isEnabled) {
    await prisma.toolExecution.update({ where: { id: pending.id }, data: { status: "CANCELLED", resolvedAt: new Date(), error: "The tool is disabled." } });
    return { state: "CANCELLED", summary, toolName: pending.toolName, executionId: pending.id };
  }

  const result = await execute(tool, pending.input as ToolInputValues, { ...ctx, triggeredBy: "CONFIRMATION" });

  await prisma.toolExecution.update({
    where: { id: pending.id },
    data: {
      status: result.ok ? "SUCCESS" : "ERROR",
      output: result.ok ? (trimForModel(result.output) as Prisma.InputJsonValue) : undefined,
      error: result.ok ? null : result.error,
      latencyMs: Math.round(result.latencyMs),
      triggeredBy: "CONFIRMATION",
      resolvedAt: new Date(),
      runId: ctx.runId ?? pending.runId,
    },
  });

  return {
    state: "EXECUTED",
    summary,
    toolName: pending.toolName,
    toolKey: pending.toolKey,
    executionId: pending.id,
    status: result.ok ? "SUCCESS" : "ERROR",
    output: result.ok ? trimForModel(result.output) : { error: result.error },
  };
}

/**
 * Cancels "shall I go ahead?" actions nobody answered within the confirmation window
 * (the customer left). Run by the sessions cron; a reply also expires them lazily.
 */
export async function expireStaleConfirmations(now = new Date()) {
  const result = await prisma.toolExecution.updateMany({
    where: { status: "PENDING_CONFIRMATION", createdAt: { lt: new Date(now.getTime() - CONFIRMATION_TTL_MS) } },
    data: { status: "CANCELLED", resolvedAt: now, error: "Confirmation expired: the customer did not answer." },
  });
  return result.count;
}

/** Admin "Test tool": runs once for real (reads and writes) and logs it as TEST. */
export async function testTool(workspaceId: string, row: AgentTool, rawInput: unknown, actor: { id: string }) {
  const tool = toRuntimeTool(row);

  if (!tool) {
    return { ok: false as const, error: "This tool is not fully configured." };
  }

  const ctx: ToolContext = {
    workspaceId,
    agentId: null,
    runId: null,
    step: 1,
    sessionId: null,
    ticketId: null,
    contactId: null,
    channel: "PLAYGROUND",
    verifiedIdentity: false,
    customer: { name: null, email: null, phone: null },
    timeZone: "UTC",
    // Built-in writes are simulated in tests; HTTP tools really call the API.
    dryRun: tool.type === "BUILT_IN" && tool.effect === "WRITE",
    triggeredBy: "TEST",
  };
  const result = await runTool({ tool, rawInput, ctx });

  await prisma.agentTool.update({
    where: { id: row.id },
    data: { lastTestedAt: new Date(), lastTestStatus: result.status === "SUCCESS" ? "OK" : String((result.output as { error?: string })?.error ?? result.status).slice(0, 200) },
    select: { id: true },
  });

  return { ok: result.status === "SUCCESS", status: result.status, output: result.output, actor: actor.id };
}
