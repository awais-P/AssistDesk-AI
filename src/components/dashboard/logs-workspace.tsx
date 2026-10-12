"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { LogsTabs } from "./logs-tabs";

type LogItem = {
  id: string;
  createdAt: string;
  action: string;
  status: string;
  model: string | null;
  tokens: number;
  durationMs: number;
  summary: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
  agentName: string | null;
};

type LogFilters = {
  action: string;
  status: string;
  query: string;
};

type LogsWorkspaceProps = {
  logs: LogItem[];
  filters: LogFilters;
  actionOptions: string[];
  statusOptions: string[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
};

function formatLabel(value: string) {
  const text = value.toLowerCase().replace(/_/g, " ");

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDuration(durationMs: number) {
  if (durationMs <= 0) {
    return "—";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(2)} s`;
}

function getStatusClassName(status: string) {
  if (status === "SUCCESS") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  }

  if (status === "FALLBACK" || status === "SKIPPED") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }

  if (status === "FAILED" || status === "ERROR") {
    return "border-red-500/30 bg-red-500/10 text-red-200";
  }

  return "border-white/10 bg-[#111111] text-slate-300";
}

function buildLogsUrl(filters: LogFilters, page: number) {
  const params = new URLSearchParams();

  if (filters.query) {
    params.set("q", filters.query);
  }

  if (filters.action) {
    params.set("action", filters.action);
  }

  if (filters.status) {
    params.set("status", filters.status);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const search = params.toString();

  return search ? `/dashboard/logs?${search}` : "/dashboard/logs";
}

export function LogsWorkspace({
  logs,
  filters,
  actionOptions,
  statusOptions,
  pagination,
}: LogsWorkspaceProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(filters.query);
  const [timeZone, setTimeZone] = useState<string | null>(null);

  // Dates are only rendered after mount, in the browser's time zone, so the
  // server and client markup always match.
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  useEffect(() => {
    setSearch(filters.query);
  }, [filters.query]);

  const dateFormatter = useMemo(() => {
    if (!timeZone) {
      return null;
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });
  }, [timeZone]);

  function navigate(nextFilters: LogFilters, page = 1) {
    startTransition(() => {
      router.push(buildLogsUrl(nextFilters, page));
    });
  }

  const hasFilters = Boolean(filters.action || filters.status || filters.query);
  const firstItem =
    pagination.totalCount === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const lastItem = Math.min(pagination.page * pagination.pageSize, pagination.totalCount);

  return (
    <div className="px-5 py-4 md:px-6">
      <div>
        <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
          Logs
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-400">
          Monitor automation jobs and AI model usage
        </p>
        <LogsTabs active="automation" />
      </div>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-end">
        <form
          role="search"
          className="flex min-w-0 flex-1 flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ ...filters, query: search.trim() });
          }}
        >
          <label htmlFor="logs-search" className="text-sm font-medium text-white">
            Search
          </label>
          <div className="flex gap-2">
            <div className="inline-flex h-11 min-w-0 flex-1 items-center rounded-lg border border-white/10 bg-[#111111] px-3">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 shrink-0 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3-3" />
              </svg>
              <input
                id="logs-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ticket number (e.g. 1042) or summary text"
                className="ml-3 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
              />
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="pressable inline-flex h-11 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
            >
              Search
            </button>
          </div>
        </form>

        <div className="flex flex-col gap-2">
          <label htmlFor="logs-action" className="text-sm font-medium text-white">
            Action
          </label>
          <select
            id="logs-action"
            value={filters.action}
            disabled={isPending}
            onChange={(event) => navigate({ ...filters, action: event.target.value })}
            className="h-11 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white outline-none"
          >
            <option value="">All actions</option>
            {actionOptions.map((option) => (
              <option key={option} value={option}>
                {formatLabel(option)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="logs-status" className="text-sm font-medium text-white">
            Status
          </label>
          <select
            id="logs-status"
            value={filters.status}
            disabled={isPending}
            onChange={(event) => navigate({ ...filters, status: event.target.value })}
            className="h-11 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white outline-none"
          >
            <option value="">All statuses</option>
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {formatLabel(option)}
              </option>
            ))}
          </select>
        </div>

        {hasFilters ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setSearch("");
              navigate({ action: "", status: "", query: "" });
            }}
            className="pressable inline-flex h-11 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 text-sm font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-50"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      <div
        className={`mt-6 rounded-[22px] border border-white/10 bg-[#0a0a0a] transition ${
          isPending ? "opacity-60" : ""
        }`}
        aria-busy={isPending}
      >
        {logs.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-16 text-center">
            <svg
              viewBox="0 0 24 24"
              className="h-10 w-10 text-slate-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M4 12h5l2-5 3 10 2-5h4" />
            </svg>
            <p className="mt-4 text-xl text-slate-300">
              {hasFilters ? "No logs match these filters" : "No logs available"}
            </p>
            <p className="mt-2 max-w-md text-sm text-slate-500">
              {hasFilters
                ? "Try a different ticket number, action or status, or clear the filters."
                : "Logs appear here once AI agents reply, draft or run automations."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white">
                  <th scope="col" className="px-4 py-5 font-semibold">Date</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Action</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Ticket</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Agent</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Model</th>
                  <th scope="col" className="px-4 py-5 text-right font-semibold">Tokens</th>
                  <th scope="col" className="px-4 py-5 text-right font-semibold">Duration</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Summary</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-white/10 text-white last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-4 text-slate-300">
                      {dateFormatter ? dateFormatter.format(new Date(log.createdAt)) : "…"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">{formatLabel(log.action)}</td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-medium ${getStatusClassName(
                          log.status,
                        )}`}
                      >
                        {formatLabel(log.status)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      {log.ticketId && log.ticketNumber !== null ? (
                        <Link
                          href={`/dashboard/tickets/${log.ticketId}`}
                          className="text-white underline decoration-white/30 underline-offset-4 transition hover:decoration-white"
                        >
                          #{log.ticketNumber}
                        </Link>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-300">
                      {log.agentName ?? "System"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-300">
                      {log.model ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">
                      {log.tokens > 0 ? log.tokens.toLocaleString("en-US") : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">
                      {formatDuration(log.durationMs)}
                    </td>
                    <td className="max-w-[320px] px-4 py-4 text-slate-400">
                      <span className="line-clamp-2" title={log.summary ?? undefined}>
                        {log.summary ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-white/10 px-4 py-5 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Showing {firstItem} to {lastItem} of {pagination.totalCount} results
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous page"
              disabled={pagination.page <= 1 || isPending}
              onClick={() => navigate(filters, pagination.page - 1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              ‹
            </button>
            <span className="px-2 text-slate-300">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={pagination.page >= pagination.totalPages || isPending}
              onClick={() => navigate(filters, pagination.page + 1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
