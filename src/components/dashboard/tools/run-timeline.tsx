"use client";

import { type ReactNode, useState } from "react";
import type { RunTraceEntry } from "@/src/lib/agent-engine/run-trace";
import { Badge, formatLatency, prettyJson } from "./tool-ui";

/**
 * Module 2 FE-5 "chain of thought": one reasoning run drawn as a timeline — rules that
 * matched, the agent's thoughts, every action with its reason, input and result,
 * model errors, fallbacks and hand-overs. Shared by Action Logs, Playground and Chats.
 */

export type TimelineExecution = {
  id: string;
  toolKey: string;
  toolName: string;
  step: number;
  reasoning: string | null;
  input: unknown;
  output: unknown;
  status: string;
  error: string | null;
  latencyMs: number;
  triggeredBy: string;
  dryRun: boolean;
  createdAt: string;
  resolvedAt: string | null;
};

export type TimelineRun = {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  model: string | null;
  latencyMs: number;
  steps: number;
  toolCalls: number;
  trace: RunTraceEntry[];
  executions: TimelineExecution[];
};

export const runStatusLabels: Record<string, string> = {
  COMPLETED: "Completed",
  AWAITING_CONFIRMATION: "Waiting for customer",
  MAX_STEPS: "Step limit reached",
  FALLBACK: "Fallback answer",
  FAILED: "No AI reply",
  RUNNING: "Running",
};

export function runStatusTone(status: string) {
  if (status === "COMPLETED") return "ok" as const;
  if (status === "AWAITING_CONFIRMATION") return "info" as const;
  if (status === "FAILED") return "error" as const;
  if (status === "RUNNING") return "neutral" as const;
  return "warn" as const;
}

export const executionStatusLabels: Record<string, string> = {
  SUCCESS: "Done",
  ERROR: "Failed",
  DENIED: "Refused",
  PENDING_CONFIRMATION: "Awaiting yes/no",
  CANCELLED: "Cancelled",
};

export function executionStatusTone(status: string) {
  if (status === "SUCCESS") return "ok" as const;
  if (status === "ERROR") return "error" as const;
  if (status === "PENDING_CONFIRMATION") return "info" as const;
  return "warn" as const;
}

const triggerLabels: Record<string, string> = {
  MODEL: "Chosen by AI",
  RULE: "Automatic rule",
  CONFIRMATION: "After customer's yes",
  TEST: "Admin test",
};

function Dot({ tone }: { tone: "white" | "green" | "red" | "amber" | "violet" | "sky" | "slate" }) {
  const colors = {
    white: "bg-white",
    green: "bg-emerald-400",
    red: "bg-red-400",
    amber: "bg-amber-300",
    violet: "bg-violet-300",
    sky: "bg-sky-300",
    slate: "bg-slate-500",
  };
  return <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-[#090909] ${colors[tone]}`} aria-hidden="true" />;
}

function Item({ tone, label, children }: { tone: Parameters<typeof Dot>[0]["tone"]; label: ReactNode; children?: ReactNode }) {
  return (
    <li className="relative">
      <Dot tone={tone} />
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {children ? <div className="mt-1">{children}</div> : null}
    </li>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  const text = prettyJson(value);

  return (
    <div>
      <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="text-[11px] font-semibold text-slate-400 hover:text-white">
        {open ? "▾" : "▸"} {label}
      </button>
      {open ? <pre className="mt-1 max-h-72 overflow-auto rounded-lg border border-white/10 bg-[#050505] p-2.5 text-[11px] leading-5 text-slate-200">{text}</pre> : null}
    </div>
  );
}

function ExecutionCard({ execution, fallback }: { execution: TimelineExecution | null; fallback?: { toolName: string; status: string; reason: string | null } }) {
  const name = execution?.toolName ?? fallback?.toolName ?? "Action";
  const status = execution?.status ?? fallback?.status ?? "";
  const reason = execution?.reasoning ?? fallback?.reason ?? null;
  const input = execution?.input && typeof execution.input === "object" ? Object.fromEntries(Object.entries(execution.input as Record<string, unknown>).filter(([key]) => key !== "reason")) : execution?.input;

  return (
    <div className="rounded-xl border border-white/10 bg-[#0f0f0f] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-white">{name}</span>
        {status ? <Badge tone={executionStatusTone(status)}>{executionStatusLabels[status] ?? status}</Badge> : null}
        {execution?.dryRun ? <Badge tone="read">Test mode</Badge> : null}
        {execution && execution.triggeredBy !== "MODEL" ? <Badge>{triggerLabels[execution.triggeredBy] ?? execution.triggeredBy}</Badge> : null}
        {execution && execution.latencyMs > 0 ? <span className="text-[11px] text-slate-500">{formatLatency(execution.latencyMs)}</span> : null}
      </div>
      {reason ? (
        <p className="mt-1.5 text-xs leading-5 text-slate-300">
          <span className="text-slate-500">Why: </span>
          {reason}
        </p>
      ) : null}
      {execution?.error ? <p className="mt-1.5 rounded-lg bg-red-500/[0.08] px-2.5 py-1.5 text-xs text-red-200">{execution.error}</p> : null}
      {execution ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <JsonBlock label="Input" value={input} />
          {execution.output !== null && execution.output !== undefined ? <JsonBlock label="Result" value={execution.output} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export function RunTimeline({ run, compact = false }: { run: TimelineRun; compact?: boolean }) {
  const byId = new Map(run.executions.map((execution) => [execution.id, execution]));
  const shown = new Set<string>();
  const items: ReactNode[] = [];

  items.push(
    <Item key="question" tone="white" label="Customer">
      <p className="whitespace-pre-wrap text-sm text-white">{run.question}</p>
    </Item>,
  );

  run.trace.forEach((entry, index) => {
    const key = `${entry.type}-${index}`;

    switch (entry.type) {
      case "confirmation": {
        shown.add(entry.executionId);
        const verb = entry.state === "EXECUTED" ? "Customer said yes — ran the waiting action" : entry.state === "CANCELLED" ? "Customer said no — cancelled the waiting action" : "Still waiting for the customer's yes or no";
        items.push(
          <Item key={key} tone={entry.state === "CANCELLED" ? "amber" : "violet"} label={verb}>
            <ExecutionCard execution={byId.get(entry.executionId) ?? null} fallback={{ toolName: entry.toolName, status: entry.status ?? "", reason: entry.summary }} />
          </Item>,
        );
        break;
      }
      case "intent":
        items.push(
          <Item key={key} tone="sky" label="Intent rule matched">
            <p className="text-xs text-slate-300">
              {entry.rules.map((rule) => `“${rule.phrases[0]}” → ${rule.toolKey}${rule.mode === "ALWAYS" ? " (always run first)" : " (suggested)"}`).join("; ")}
            </p>
          </Item>,
        );
        break;
      case "thought":
        items.push(
          <Item key={key} tone="slate" label={`Step ${entry.step} · thinking`}>
            <p className="whitespace-pre-wrap text-xs italic leading-5 text-slate-400">{entry.text}</p>
          </Item>,
        );
        break;
      case "tool": {
        const execution = entry.executionId ? byId.get(entry.executionId) ?? null : null;
        if (entry.executionId) shown.add(entry.executionId);
        items.push(
          <Item key={key} tone={entry.status === "SUCCESS" ? "green" : entry.status === "ERROR" || entry.status === "DENIED" ? "red" : "violet"} label={`Step ${entry.step} · action`}>
            <ExecutionCard execution={execution} fallback={{ toolName: entry.toolName, status: execution?.status ?? entry.status, reason: entry.reason }} />
          </Item>,
        );
        break;
      }
      case "model_error":
        items.push(
          <Item key={key} tone="amber" label={`Step ${entry.step} · model unavailable`}>
            <p className="text-xs text-amber-100">
              <code>{entry.model}</code> failed ({entry.error}). Tried the next model.
            </p>
          </Item>,
        );
        break;
      case "error":
        items.push(
          <Item key={key} tone="red" label="Reasoning stopped">
            <p className="text-xs text-red-200">{entry.error}</p>
          </Item>,
        );
        break;
      case "fallback":
        items.push(
          <Item key={key} tone="amber" label="Fallback">
            <p className="text-xs text-amber-100">{entry.detail}</p>
          </Item>,
        );
        break;
      case "escalation":
        items.push(
          <Item key={key} tone="violet" label="Handed over to the team">
            <p className="text-xs text-violet-100">{entry.reason}</p>
          </Item>,
        );
        break;
    }
  });

  // Actions the trace doesn't mention (automatic hand-over, runs from before traces were stored).
  for (const execution of run.executions) {
    if (shown.has(execution.id)) continue;
    items.push(
      <Item key={execution.id} tone={execution.status === "SUCCESS" ? "green" : execution.status === "ERROR" ? "red" : "violet"} label={execution.triggeredBy === "RULE" ? "Automatic action" : `Step ${execution.step} · action`}>
        <ExecutionCard execution={execution} />
      </Item>,
    );
  }

  items.push(
    <Item
      key="answer"
      tone={run.status === "COMPLETED" ? "green" : run.status === "FAILED" ? "red" : "white"}
      label={
        <span className="flex flex-wrap items-center gap-2 normal-case tracking-normal">
          <span className="uppercase tracking-wide">AI reply</span>
          <Badge tone={runStatusTone(run.status)}>{runStatusLabels[run.status] ?? run.status}</Badge>
          {run.model ? <code className="text-[11px] font-normal text-slate-500">{run.model}</code> : null}
          {run.latencyMs ? <span className="text-[11px] font-normal text-slate-500">{formatLatency(run.latencyMs)}</span> : null}
        </span>
      }
    >
      {run.answer ? <p className={`whitespace-pre-wrap text-sm text-slate-200 ${compact ? "line-clamp-4" : ""}`}>{run.answer}</p> : <p className="text-xs text-slate-500">No reply yet.</p>}
    </Item>,
  );

  return <ol className="ml-[9px] space-y-4 border-l border-white/10 pl-5">{items}</ol>;
}
