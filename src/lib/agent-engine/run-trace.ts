import { cleanModelError } from "../model-health";
import type { ConfirmationOutcome } from "../tools/registry";
import type { TraceEntry } from "./graph";
import type { IntentRule } from "./intent-rules";

/**
 * Module 2 FE-5 "chain of thought": what one reasoning run decided, in order. Stored on
 * AgentRun.trace; actions are referenced by execution id (their inputs and outputs live
 * on ToolExecution). Pure functions, unit-tested.
 */

export type RunTraceEntry =
  | { type: "confirmation"; state: "STILL_PENDING" | "CANCELLED" | "EXECUTED"; toolName: string; summary: string; executionId: string; status?: "SUCCESS" | "ERROR" }
  | { type: "intent"; rules: Array<{ toolKey: string; mode: "PREFER" | "ALWAYS"; phrases: string[] }>; forcedTool: string | null }
  | { type: "thought"; step: number; text: string }
  | { type: "tool"; step: number; toolKey: string; toolName: string; status: string; reason: string | null; executionId: string | null }
  | { type: "model_error"; step: number; model: string; error: string }
  | { type: "error"; error: string }
  | { type: "fallback"; kind: "confirmation" | "tool_results" | "knowledge" | "none"; detail: string }
  | { type: "escalation"; reason: string };

const MAX_ENTRIES = 60;
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

export function buildRunTrace({
  confirmation,
  matchedRules,
  forcedTool,
  graphTrace,
  graphError,
  fallback,
  escalation,
}: {
  confirmation: ConfirmationOutcome;
  matchedRules: IntentRule[];
  forcedTool: string | null;
  graphTrace: TraceEntry[];
  graphError: string | null;
  fallback: Extract<RunTraceEntry, { type: "fallback" }> | null;
  escalation: string | null;
}): RunTraceEntry[] {
  const entries: RunTraceEntry[] = [];

  if (confirmation.state !== "NONE") {
    entries.push({
      type: "confirmation",
      state: confirmation.state,
      toolName: confirmation.toolName,
      summary: clip(confirmation.summary, 300),
      executionId: confirmation.executionId,
      ...(confirmation.state === "EXECUTED" ? { status: confirmation.status } : {}),
    });
  }

  if (matchedRules.length > 0) {
    entries.push({
      type: "intent",
      rules: matchedRules.map((rule) => ({ toolKey: rule.toolKey, mode: rule.mode, phrases: rule.phrases.slice(0, 3) })),
      forcedTool,
    });
  }

  for (const entry of graphTrace) {
    if (entry.type === "thought") {
      if (entry.text.trim()) entries.push({ type: "thought", step: entry.step, text: clip(entry.text.trim(), 800) });
    } else if (entry.type === "tool") {
      entries.push({
        type: "tool",
        step: entry.step,
        toolKey: entry.toolKey,
        toolName: entry.toolName,
        status: entry.status,
        reason: entry.reason ? clip(entry.reason, 400) : null,
        executionId: entry.executionId,
      });
    } else {
      entries.push({ type: "model_error", step: entry.step, model: entry.model, error: clip(cleanModelError(entry.error), 300) });
    }
  }

  if (graphError) entries.push({ type: "error", error: clip(graphError, 300) });
  if (fallback) entries.push(fallback);
  if (escalation) entries.push({ type: "escalation", reason: clip(escalation, 300) });

  // Keep the start and the end of very long runs.
  return entries.length > MAX_ENTRIES ? [...entries.slice(0, MAX_ENTRIES - 10), ...entries.slice(-10)] : entries;
}

const TYPES = new Set(["confirmation", "intent", "thought", "tool", "model_error", "error", "fallback", "escalation"]);

/** Reads a stored trace defensively (older runs have none). */
export function parseRunTrace(raw: unknown): RunTraceEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((entry): entry is RunTraceEntry => Boolean(entry) && typeof entry === "object" && TYPES.has((entry as { type?: string }).type ?? ""));
}

/** Execution ids a trace refers to (including a confirmed action from an earlier run). */
export function traceExecutionIds(trace: RunTraceEntry[]) {
  return [
    ...new Set(
      trace.flatMap((entry) => (entry.type === "tool" && entry.executionId ? [entry.executionId] : entry.type === "confirmation" ? [entry.executionId] : [])),
    ),
  ];
}
