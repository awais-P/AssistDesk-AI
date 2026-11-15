"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { AuditListResult } from "@/src/lib/audit-queries";
import { LogsTabs } from "./logs-tabs";
import { RelativeTime } from "./notifications-bell";

const categoryLabels: Record<string, string> = {
  auth: "Sign-in & accounts",
  users: "Team members & roles",
  settings: "Settings",
  integrations: "Integrations & webhooks",
  api: "API keys & API",
  data: "Data & exports",
  access: "Refused access",
  ai: "AI & knowledge",
};

const selectClass =
  "h-9 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white outline-none transition focus:border-white";
const buttonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3.5 text-sm font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-50";

function outcomeClass(outcome: string) {
  const base = "inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-medium";
  if (outcome === "DENIED") return `${base} border-red-500/40 bg-red-500/10 text-red-200`;
  if (outcome === "FAILED") return `${base} border-amber-500/30 bg-amber-500/10 text-amber-100`;
  return `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-200`;
}

type Filters = { category: string; outcome: string; actor: string; q: string; from: string; to: string; page: number };
const empty: Filters = { category: "", outcome: "", actor: "", q: "", from: "", to: "", page: 1 };

function toQuery(filters: Filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key === "page" ? value !== 1 : value) params.set(key, String(value));
  }
  return params.toString();
}

export function AuditLogWorkspace({ canView, canExport }: { canView: boolean; canExport: boolean }) {
  const [filters, setFilters] = useState<Filters>(empty);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<AuditListResult | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const query = useMemo(() => toQuery(filters), [filters]);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/audit-logs${query ? `?${query}` : ""}`, { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => ({}))) as AuditListResult & { error?: string };
        if (!response.ok) {
          setError(body.error ?? "Could not load the audit log.");
          return;
        }
        setError("");
        setData(body);
      } catch {
        if (!controller.signal.aborted) setError("Could not reach the server.");
      }
    })();
    return () => controller.abort();
  }, [query, canView]);

  useEffect(() => {
    const timer = window.setTimeout(() => setFilters((current) => (current.q === search.trim() ? current : { ...current, q: search.trim(), page: 1 })), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">Logs</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-400">
            Security & audit: sign-ins, team and role changes, settings, integrations, API keys, data exports and refused access. Entries
            can&apos;t be edited or deleted.
          </p>
          <LogsTabs active="audit" />
        </div>
        {canView && canExport ? (
          <a href={`/api/audit-logs?${toQuery({ ...filters, page: 1 })}${query ? "&" : ""}format=csv`} download className={buttonClass}>
            Export CSV
          </a>
        ) : null}
      </div>

      {!canView ? (
        <p className="mt-6 rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-slate-300">
          The security & audit log is visible to workspace admins (or roles given the &quot;View the security &amp; audit log&quot; permission).
        </p>
      ) : (
        <>
          {data ? (
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Entries (filtered)</p>
                <p className="mt-1 text-2xl font-semibold text-white">{data.total.toLocaleString("en-US")}</p>
              </div>
              <div className={`rounded-2xl border px-4 py-3 ${data.summary.denied7d ? "border-red-500/30 bg-red-500/10" : "border-white/10 bg-[#0a0a0a]"}`}>
                <p className="text-xs uppercase tracking-wide text-slate-400">Refused access, 7 days</p>
                <p className="mt-1 text-2xl font-semibold text-white">{data.summary.denied7d}</p>
              </div>
              <div className={`rounded-2xl border px-4 py-3 ${data.summary.failedLogins7d ? "border-amber-500/30 bg-amber-500/10" : "border-white/10 bg-[#0a0a0a]"}`}>
                <p className="text-xs uppercase tracking-wide text-slate-400">Failed sign-ins, 7 days</p>
                <p className="mt-1 text-2xl font-semibold text-white">{data.summary.failedLogins7d}</p>
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-end gap-2.5">
            <label className="sr-only" htmlFor="audit-search">
              Search the audit log
            </label>
            <input
              id="audit-search"
              type="search"
              value={search}
              maxLength={120}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search action, person or text"
              className={`${selectClass} w-full sm:w-72`}
            />
            <label className="sr-only" htmlFor="audit-category">
              Category
            </label>
            <select id="audit-category" value={filters.category} onChange={(event) => update({ category: event.target.value })} className={selectClass}>
              <option value="">All categories</option>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="audit-outcome">
              Outcome
            </label>
            <select id="audit-outcome" value={filters.outcome} onChange={(event) => update({ outcome: event.target.value })} className={selectClass}>
              <option value="">Any outcome</option>
              <option value="SUCCESS">Done</option>
              <option value="DENIED">Refused</option>
              <option value="FAILED">Failed</option>
            </select>
            <label className="sr-only" htmlFor="audit-actor">
              Who
            </label>
            <select id="audit-actor" value={filters.actor} onChange={(event) => update({ actor: event.target.value })} className={selectClass}>
              <option value="">Anyone</option>
              {data?.actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                  {actor.type === "API_KEY" ? " (API key)" : ""}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              From
              <input type="date" value={filters.from} onChange={(event) => update({ from: event.target.value })} className={`${selectClass} [color-scheme:dark]`} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              to
              <input type="date" value={filters.to} onChange={(event) => update({ to: event.target.value })} className={`${selectClass} [color-scheme:dark]`} />
            </label>
            {toQuery({ ...filters, page: 1 }) ? (
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  setSearch("");
                  setFilters(empty);
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          ) : null}

          <div className="mt-4 overflow-x-auto rounded-[22px] border border-white/10 bg-[#0a0a0a]">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white">
                  <th scope="col" className="px-4 py-4 font-semibold">When</th>
                  <th scope="col" className="px-4 py-4 font-semibold">Who</th>
                  <th scope="col" className="px-4 py-4 font-semibold">What happened</th>
                  <th scope="col" className="px-4 py-4 font-semibold">Category</th>
                  <th scope="col" className="px-4 py-4 font-semibold">Outcome</th>
                  <th scope="col" className="px-4 py-4 font-semibold">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data && data.entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                      No entries match these filters.
                    </td>
                  </tr>
                ) : null}
                {data?.entries.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr className="border-b border-white/10 text-slate-200 last:border-b-0">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-400" title={entry.createdAt}>
                        <RelativeTime value={entry.createdAt} />
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-3">
                        {entry.actorName}
                        {entry.actorType !== "USER" ? <span className="ml-1 text-xs text-slate-500">({entry.actorType === "API_KEY" ? "API key" : "system"})</span> : null}
                      </td>
                      <td className="max-w-[460px] px-4 py-3">
                        <p className="truncate" title={entry.summary}>
                          {entry.summary}
                        </p>
                        <p className="text-xs text-slate-500">{entry.action}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-400">{categoryLabels[entry.category] ?? entry.category}</td>
                      <td className="px-4 py-3">
                        <span className={outcomeClass(entry.outcome)}>{entry.outcome === "SUCCESS" ? "Done" : entry.outcome === "DENIED" ? "Refused" : "Failed"}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          aria-expanded={open === entry.id}
                          onClick={() => setOpen(open === entry.id ? null : entry.id)}
                          className="text-xs text-slate-400 underline underline-offset-2 hover:text-white"
                        >
                          {open === entry.id ? "Hide" : "Details"}
                        </button>
                      </td>
                    </tr>
                    {open === entry.id ? (
                      <tr className="border-b border-white/10 bg-black/40">
                        <td colSpan={6} className="px-4 py-3 text-xs text-slate-300">
                          <p>Time: {entry.createdAt}</p>
                          {entry.targetType ? (
                            <p>
                              Target: {entry.targetType} {entry.targetId}
                            </p>
                          ) : null}
                          {entry.ipHash ? <p>Network (hashed): {entry.ipHash}</p> : null}
                          {entry.userAgent ? <p className="truncate">Browser / client: {entry.userAgent}</p> : null}
                          {entry.metadata ? <pre className="mt-2 whitespace-pre-wrap break-all text-slate-400">{JSON.stringify(entry.metadata, null, 2)}</pre> : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {data && data.pageCount > 1 ? (
            <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
              <span>
                Page {data.page} of {data.pageCount}
              </span>
              <div className="flex gap-2">
                <button type="button" className={buttonClass} disabled={data.page <= 1} onClick={() => update({ page: data.page - 1 })}>
                  Previous
                </button>
                <button type="button" className={buttonClass} disabled={data.page >= data.pageCount} onClick={() => update({ page: data.page + 1 })}>
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
