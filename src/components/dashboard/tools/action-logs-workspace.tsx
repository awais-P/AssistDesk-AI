"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogsTabs } from "../logs-tabs";
import { RunTimeline, type TimelineExecution, type TimelineRun, executionStatusLabels, executionStatusTone, runStatusLabels, runStatusTone } from "./run-timeline";
import { Badge, Drawer, NoticeBox, Spinner, formatDateTime, formatLatency, inputClass, readJson, secondaryButtonClass } from "./tool-ui";

/**
 * Module 2 FE-5 Action Logs: every reasoning run (customer message → chain of thought →
 * reply) and every action the AI took, paginated, filterable and sortable (SRS UI-4).
 */

type View = "runs" | "actions";

type Filters = {
  view: View;
  q: string;
  status: string;
  source: string;
  trigger: string;
  agent: string;
  tool: string;
  from: string;
  to: string;
  sort: string;
  page: number;
  session: string;
};

type RunRow = {
  id: string;
  source: string;
  question: string;
  answer: string | null;
  status: string;
  steps: number;
  toolCalls: number;
  model: string | null;
  latencyMs: number;
  error: string | null;
  createdAt: string;
  sessionId: string | null;
  ticketId: string | null;
  ticketReference: string | null;
  agent: { id: string; name: string } | null;
  actions: Array<{ toolName: string; status: string }>;
};

type ActionRow = TimelineExecution & {
  runId: string | null;
  sessionId: string | null;
  ticketId: string | null;
  agent: { id: string; name: string } | null;
  source: string | null;
  question: string | null;
};

type Summary = { runs: number; actions: number; successRate: number | null; failedActions: number; fallbacks: number; awaitingConfirmation: number };

type ListResponse = {
  view: View;
  rows: Array<RunRow | ActionRow>;
  total: number;
  page: number;
  pageSize: number;
  summary: Summary;
  options: { agents: Array<{ id: string; name: string }>; tools: Array<{ key: string; name: string }> };
};

type RunDetail = TimelineRun & {
  source: string;
  createdAt: string;
  agent: { id: string; name: string } | null;
  sessionId: string | null;
  ticketId: string | null;
  ticket: { reference: string; subject: string } | null;
  customer: { name: string | null; email: string | null; contactId: string | null } | null;
  error: string | null;
};

const EMPTY: Filters = { view: "runs", q: "", status: "", source: "", trigger: "", agent: "", tool: "", from: "", to: "", sort: "newest", page: 1, session: "" };

const sourceLabels: Record<string, string> = { CHAT: "Chat", EMAIL: "Email", PLAYGROUND: "Playground", TEST: "Admin test" };
const selectClass = `${inputClass} h-10 w-auto min-w-[140px]`;

function filtersFromUrl(): { filters: Filters; run: string | null } {
  const params = new URLSearchParams(window.location.search);
  return {
    filters: {
      view: params.get("view") === "actions" ? "actions" : "runs",
      q: params.get("q") ?? "",
      status: params.get("status") ?? "",
      source: params.get("source") ?? "",
      trigger: params.get("trigger") ?? "",
      agent: params.get("agent") ?? "",
      tool: params.get("tool") ?? "",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
      sort: params.get("sort") ?? "newest",
      page: Math.max(1, Number(params.get("page")) || 1),
      session: params.get("session") ?? "",
    },
    run: params.get("run"),
  };
}

function toParams(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.view !== "runs") params.set("view", filters.view);
  for (const key of ["q", "status", "source", "trigger", "agent", "tool", "from", "to", "session"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

function ActionChips({ actions, more }: { actions: RunRow["actions"]; more: number }) {
  if (actions.length === 0) {
    return <span className="text-xs text-slate-600">—</span>;
  }

  return (
    <div className="flex max-w-[260px] flex-wrap gap-1">
      {actions.map((action, index) => (
        <Badge key={`${action.toolName}-${index}`} tone={executionStatusTone(action.status)}>
          {action.toolName}
        </Badge>
      ))}
      {more > 0 ? <Badge>+{more}</Badge> : null}
    </div>
  );
}

function RunDrawer({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setRun(null);
    setError(null);

    void (async () => {
      const response = await fetch(`/api/action-logs/runs/${runId}`, { cache: "no-store" });
      const body = await readJson<{ run: RunDetail }>(response);
      if (cancelled) return;
      if (response.ok) setRun(body.run);
      else setError(body.error ?? "Could not load this run.");
    })();

    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <Drawer open={Boolean(runId)} width="max-w-[680px]" title="Chain of thought" description="How the AI handled this message, step by step." onClose={onClose}>
      {error ? <NoticeBox notice={{ tone: "error", text: error }} /> : null}
      {!run && !error ? (
        <p className="flex items-center text-sm text-slate-400">
          <Spinner /> Loading…
        </p>
      ) : null}
      {run ? (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {[
              ["When", formatDateTime(run.createdAt)],
              ["Where", sourceLabels[run.source] ?? run.source],
              ["Agent", run.agent?.name ?? "Deleted agent"],
              ["Steps · actions", `${run.steps} · ${run.toolCalls}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-white/[0.03] px-3 py-2">
                <dt className="text-slate-500">{label}</dt>
                <dd className="mt-0.5 truncate font-semibold text-white">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            {run.sessionId ? (
              <Link href={`/dashboard/chats?session=${encodeURIComponent(run.sessionId)}`} className={secondaryButtonClass}>
                Open chat
              </Link>
            ) : null}
            {run.ticketId ? (
              <Link href={`/dashboard/tickets/${run.ticketId}`} className={secondaryButtonClass}>
                Open ticket {run.ticket?.reference}
              </Link>
            ) : null}
            {run.customer?.contactId ? (
              <Link href={`/dashboard/contacts/${run.customer.contactId}`} className={secondaryButtonClass}>
                {run.customer.name ?? run.customer.email ?? "Customer"}
              </Link>
            ) : null}
          </div>
          {run.error && run.status !== "COMPLETED" ? <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{run.error}</p> : null}
          <RunTimeline run={run} />
        </div>
      ) : null}
    </Drawer>
  );
}

function ExecutionDrawer({ execution, onClose }: { execution: ActionRow | null; onClose: () => void }) {
  return (
    <Drawer open={Boolean(execution)} title={execution?.toolName ?? "Action"} description="An action outside a conversation (for example an admin test)." onClose={onClose}>
      {execution ? (
        <RunTimeline
          run={{
            id: execution.id,
            question: execution.question ?? "Run from the Tools page",
            answer: null,
            status: execution.status === "SUCCESS" ? "COMPLETED" : "FAILED",
            model: null,
            latencyMs: execution.latencyMs,
            steps: 1,
            toolCalls: 1,
            trace: [],
            executions: [execution],
          }}
        />
      ) : null}
    </Drawer>
  );
}

export function ActionLogsWorkspace() {
  const [filters, setFilters] = useState<Filters | null>(null);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [openExecution, setOpenExecution] = useState<ActionRow | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const initial = filtersFromUrl();
    setFilters(initial.filters);
    setSearch(initial.filters.q);
    setOpenRun(initial.run);
  }, []);

  const load = useCallback(async (current: Filters) => {
    const id = ++requestId.current;
    setIsLoading(true);
    setError(null);
    const params = toParams(current);
    const response = await fetch(`/api/action-logs?${params}`, { cache: "no-store" });
    const body = await readJson<ListResponse>(response);
    if (id !== requestId.current) return;
    setIsLoading(false);

    if (!response.ok) {
      setError(body.error ?? "Could not load the action logs.");
      return;
    }

    setData(body);
  }, []);

  useEffect(() => {
    if (!filters) return;
    void load(filters);
    const params = toParams(filters);
    params.set("tab", "actions");
    if (openRun) params.set("run", openRun);
    window.history.replaceState(null, "", `/dashboard/logs?${params}`);
  }, [filters, openRun, load]);

  if (!filters) {
    return null;
  }

  const update = (patch: Partial<Filters>) => setFilters({ ...filters, page: 1, ...patch });
  const hasFilters = Boolean(filters.q || filters.status || filters.source || filters.trigger || filters.agent || filters.tool || filters.from || filters.to || filters.session);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const rows = data && data.view === filters.view ? data.rows : [];

  return (
    <div className="px-5 py-4 md:px-6">
      <div>
        <h1 className="heading-font text-[2rem] font-bold leading-none text-white">Logs</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-400">
          Every message the AI reasoned about, the actions it took and why — its chain of thought.
        </p>
        <LogsTabs active="actions" />
      </div>

      {data ? (
        <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            { label: "Conversation turns", value: data.summary.runs, hint: "Customer messages the AI reasoned about" },
            { label: "Actions", value: data.summary.actions, hint: "Real actions (not tests)" },
            { label: "Action success", value: data.summary.successRate === null ? "—" : `${data.summary.successRate}%` },
            { label: "Failed actions", value: data.summary.failedActions, tone: data.summary.failedActions ? "text-red-300" : "" },
            { label: "Fallback answers", value: data.summary.fallbacks, tone: data.summary.fallbacks ? "text-amber-200" : "" },
            { label: "Waiting for customer", value: data.summary.awaitingConfirmation },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-[#0a0a0a] px-4 py-3" title={item.hint}>
              <dt className="text-xs text-slate-500">{item.label}</dt>
              <dd className={`mt-1 text-xl font-semibold text-white ${item.tone ?? ""}`}>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="mt-2 text-[11px] text-slate-500">{filters.from || filters.to ? "Totals for the chosen dates." : "Totals for the last 30 days, without Playground tests."}</p>

      <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div role="tablist" aria-label="What to list" className="inline-flex w-fit rounded-xl bg-[#1a1a1a] p-1">
          {(
            [
              ["runs", "Conversation turns"],
              ["actions", "Individual actions"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filters.view === key}
              onClick={() => update({ view: key, status: "", sort: "newest", trigger: "" })}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${filters.view === key ? "bg-[#2b2b2b] text-white" : "text-slate-400 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <form
          role="search"
          className="flex min-w-0 gap-2 xl:w-[420px]"
          onSubmit={(event) => {
            event.preventDefault();
            update({ q: search.trim() });
          }}
        >
          <input
            aria-label="Search the action logs"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={filters.view === "runs" ? "Search customer messages and replies" : "Search reasons, actions and errors"}
            className={`${inputClass} h-10`}
          />
          <button type="submit" className={`${secondaryButtonClass} h-10`}>
            Search
          </button>
        </form>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <select aria-label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value })} className={selectClass}>
          <option value="">Any status</option>
          {Object.entries(filters.view === "runs" ? runStatusLabels : executionStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Where" value={filters.source} onChange={(event) => update({ source: event.target.value })} className={selectClass}>
          <option value="">Chat, email & playground</option>
          <option value="CHAT">Chat</option>
          <option value="EMAIL">Email</option>
          <option value="PLAYGROUND">Playground</option>
        </select>
        {filters.view === "actions" ? (
          <select aria-label="Triggered by" value={filters.trigger} onChange={(event) => update({ trigger: event.target.value })} className={selectClass}>
            <option value="">Any trigger</option>
            <option value="MODEL">Chosen by AI</option>
            <option value="CONFIRMATION">After customer&apos;s yes</option>
            <option value="RULE">Automatic rule</option>
            <option value="TEST">Admin test</option>
          </select>
        ) : null}
        <select aria-label="Agent" value={filters.agent} onChange={(event) => update({ agent: event.target.value })} className={selectClass}>
          <option value="">All agents</option>
          {data?.options.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <select aria-label="Action" value={filters.tool} onChange={(event) => update({ tool: event.target.value })} className={selectClass}>
          <option value="">Any action</option>
          {data?.options.tools.map((tool) => (
            <option key={tool.key} value={tool.key}>
              {tool.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          From
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => update({ from: event.target.value })} className={`${inputClass} h-10 w-[150px]`} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          To
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => update({ to: event.target.value })} className={`${inputClass} h-10 w-[150px]`} />
        </label>
        <select aria-label="Sort" value={filters.sort} onChange={(event) => update({ sort: event.target.value })} className={selectClass}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="slowest">Slowest first</option>
          {filters.view === "runs" ? <option value="most_actions">Most actions first</option> : null}
        </select>
        {hasFilters ? (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setFilters({ ...EMPTY, view: filters.view });
            }}
            className={`${secondaryButtonClass} h-10`}
          >
            Clear filters
          </button>
        ) : null}
        {isLoading ? (
          <span className="flex items-center text-xs text-slate-500">
            <Spinner /> Loading
          </span>
        ) : null}
      </div>

      {filters.session ? (
        <p className="mt-3 text-xs text-slate-400">
          Showing one conversation only.{" "}
          <button type="button" onClick={() => update({ session: "" })} className="text-white underline-offset-2 hover:underline">
            Show all
          </button>
        </p>
      ) : null}

      <div className="mt-4">
        <NoticeBox notice={error ? { tone: "error", text: error } : null} />
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-slate-500">
            {filters.view === "runs" ? (
              <tr>
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-4 py-3 font-semibold">Customer message</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
                <th className="px-4 py-3 font-semibold">Result</th>
                <th className="px-4 py-3 font-semibold">Where</th>
                <th className="px-4 py-3 text-right font-semibold">Time</th>
              </tr>
            ) : (
              <tr>
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Why</th>
                <th className="px-4 py-3 font-semibold">Result</th>
                <th className="px-4 py-3 font-semibold">Trigger</th>
                <th className="px-4 py-3 text-right font-semibold">Time</th>
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                  {!data ? "Loading…" : hasFilters ? "Nothing matches these filters." : "No AI actions yet. Switch on Actions for an agent, then chat with it on the website or in the Playground."}
                </td>
              </tr>
            ) : filters.view === "runs" ? (
              (rows as RunRow[]).map((row) => (
                <tr key={row.id} onClick={() => setOpenRun(row.id)} className="cursor-pointer align-top transition hover:bg-white/[0.03]">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">{formatDateTime(row.createdAt)}</td>
                  <td className="max-w-[340px] px-4 py-3">
                    <button type="button" onClick={() => setOpenRun(row.id)} className="line-clamp-2 text-left text-sm text-white hover:underline">
                      {row.question}
                    </button>
                    {row.answer ? <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">↳ {row.answer}</p> : null}
                  </td>
                  <td className="px-4 py-3">
                    <ActionChips actions={row.actions} more={Math.max(0, row.toolCalls - row.actions.length)} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={runStatusTone(row.status)}>{runStatusLabels[row.status] ?? row.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {sourceLabels[row.source] ?? row.source}
                    {row.ticketReference ? ` · ${row.ticketReference}` : ""}
                    {row.agent ? <span className="block text-slate-600">{row.agent.name}</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-slate-400">{formatLatency(row.latencyMs)}</td>
                </tr>
              ))
            ) : (
              (rows as ActionRow[]).map((row) => (
                <tr
                  key={row.id}
                  onClick={() => (row.runId ? setOpenRun(row.runId) : setOpenExecution(row))}
                  className="cursor-pointer align-top transition hover:bg-white/[0.03]"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => (row.runId ? setOpenRun(row.runId) : setOpenExecution(row))} className="text-left text-sm font-medium text-white hover:underline">
                      {row.toolName}
                    </button>
                    <code className="block text-[11px] text-slate-600">{row.toolKey}</code>
                  </td>
                  <td className="max-w-[340px] px-4 py-3 text-xs text-slate-300">
                    <span className="line-clamp-2">{row.reasoning ?? "—"}</span>
                    {row.error ? <span className="mt-0.5 line-clamp-1 block text-red-300">{row.error}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={executionStatusTone(row.status)}>{executionStatusLabels[row.status] ?? row.status}</Badge>
                      {row.dryRun ? <Badge tone="read">Test mode</Badge> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {row.triggeredBy === "MODEL" ? "AI" : row.triggeredBy === "CONFIRMATION" ? "Customer's yes" : row.triggeredBy === "RULE" ? "Rule" : "Admin test"}
                    {row.source && row.source !== "TEST" ? <span className="block text-slate-600">{sourceLabels[row.source] ?? row.source}</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-slate-400">{formatLatency(row.latencyMs)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 ? (
        <div className="mt-4 flex flex-col gap-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {(filters.page - 1) * data.pageSize + 1}–{Math.min(filters.page * data.pageSize, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })} className={secondaryButtonClass}>
              Previous
            </button>
            <span className="flex items-center px-2">
              Page {filters.page} of {pages}
            </span>
            <button type="button" disabled={filters.page >= pages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })} className={secondaryButtonClass}>
              Next
            </button>
          </div>
        </div>
      ) : null}

      <RunDrawer runId={openRun} onClose={() => setOpenRun(null)} />
      <ExecutionDrawer execution={openExecution} onClose={() => setOpenExecution(null)} />
    </div>
  );
}
