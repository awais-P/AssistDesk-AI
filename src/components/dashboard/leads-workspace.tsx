"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { channelBadgeClass, channelLabels, labelFrom } from "@/src/lib/contact-labels";
import {
  LEAD_STATUSES,
  OPEN_LEAD_STATUSES,
  leadSourceLabels,
  leadStatusLabels,
  type LeadStatusValue,
} from "@/src/lib/lead-form";
import {
  leadDisplayName,
  leadSourceBadgeClass,
  leadStatusBadgeClass,
  leadTemperatureBadgeClass,
  leadTemperatureLabels,
} from "@/src/lib/lead-labels";
import type { LeadListItem } from "@/src/lib/lead-list";
import { RelativeTime } from "./notifications-bell";

type LeadSortKey = "createdAt" | "lastActivityAt" | "score" | "name" | "status";

export type LeadListState = {
  q: string;
  status: string;
  source: string;
  channel: string;
  temperature: string;
  owner: string;
  from: string;
  to: string;
  sort: LeadSortKey;
  order: "asc" | "desc";
  page: number;
  pageSize: number;
};

type LeadListResponse = {
  leads: LeadListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  statusCounts: Record<string, number>;
};

type LeadsWorkspaceProps = {
  initialState: LeadListState;
  initialList: LeadListResponse;
  users: Array<{ id: string; fullName: string }>;
  currentUserId: string;
  canExport: boolean;
};

type Notice = {
  tone: "success" | "error";
  text: string;
  href?: string;
};

type FilterKey = "q" | "status" | "source" | "channel" | "temperature" | "owner" | "from" | "to";

const SEARCH_DELAY_MS = 350;
const DEFAULT_PAGE_SIZE = 25;
const pageSizeOptions = [25, 50, 100];
const filterKeys: FilterKey[] = ["q", "status", "source", "channel", "temperature", "owner", "from", "to"];
const sourceValues = ["FORM", "AUTO", "MANUAL", "AI_TOOL"];
const channelValues = ["WEB_WIDGET", "WHATSAPP", "SLACK", "EMAIL"];
const temperatureValues = ["HOT", "WARM", "COLD"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const selectClass =
  "h-9 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white outline-none transition focus:border-white disabled:opacity-60";
const inputClass =
  "w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white";
const secondaryButtonClass =
  "pressable inline-flex h-10 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 text-sm font-semibold text-white transition hover:bg-[#1a1a1a]";

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

function buildQuery(state: LeadListState, { forExport = false } = {}) {
  const params = new URLSearchParams();

  for (const key of filterKeys) {
    const value = state[key].trim();

    if (value) {
      params.set(key, value);
    }
  }

  if (state.sort !== "createdAt" || state.order !== "desc") {
    params.set("sort", state.sort);
    params.set("order", state.order);
  }

  if (!forExport) {
    if (state.pageSize !== DEFAULT_PAGE_SIZE) {
      params.set("pageSize", String(state.pageSize));
    }

    if (state.page > 1) {
      params.set("page", String(state.page));
    }
  }

  return params.toString();
}

function pluralLeads(count: number) {
  return `${count.toLocaleString("en-US")} lead${count === 1 ? "" : "s"}`;
}

function SortHeader({
  label,
  column,
  state,
  onSort,
}: {
  label: string;
  column: LeadSortKey;
  state: LeadListState;
  onSort: (column: LeadSortKey) => void;
}) {
  const isActive = state.sort === column;
  const direction = state.order === "asc" ? "ascending" : "descending";

  return (
    <th scope="col" aria-sort={isActive ? direction : "none"} className="px-4 py-5 font-semibold">
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap transition hover:text-white ${
          isActive ? "text-white" : "text-slate-200"
        }`}
      >
        {label}
        <span aria-hidden="true" className={`text-xs ${isActive ? "text-white" : "text-slate-600"}`}>
          {isActive ? (state.order === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

export function LeadsWorkspace({
  initialState,
  initialList,
  users,
  currentUserId,
  canExport,
}: LeadsWorkspaceProps) {
  const pathname = usePathname();
  const [state, setState] = useState(initialState);
  const [list, setList] = useState(initialList);
  const [searchInput, setSearchInput] = useState(initialState.q);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createCompany, setCreateCompany] = useState("");
  const [createIntent, setCreateIntent] = useState("");
  const [createStatus, setCreateStatus] = useState<LeadStatusValue>("NEW");
  const [createError, setCreateError] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const searchTimerRef = useRef<number | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = searchTimerRef;
    const controller = controllerRef;

    return () => {
      window.clearTimeout(timer.current);
      controller.current?.abort();
    };
  }, []);

  async function load(next: LeadListState) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsLoading(true);
    setError("");

    try {
      const query = buildQuery(next);
      const response = await fetch(`/api/leads${query ? `?${query}` : ""}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await readJson<Partial<LeadListResponse> & { error?: string }>(response);

      if (!response.ok || !data.leads) {
        setError(data.error ?? "Unable to load leads right now.");
        return;
      }

      setList({
        leads: data.leads,
        total: data.total ?? 0,
        page: data.page ?? next.page,
        pageSize: data.pageSize ?? next.pageSize,
        pageCount: data.pageCount ?? 1,
        statusCounts: data.statusCounts ?? {},
      });
    } catch (fetchError) {
      if ((fetchError as Error).name !== "AbortError") {
        setError("Something went wrong while loading leads.");
      }
    } finally {
      if (controllerRef.current === controller) {
        setIsLoading(false);
      }
    }
  }

  function update(changes: Partial<LeadListState>) {
    const next: LeadListState = { ...state, page: 1, ...changes };
    const query = buildQuery(next);

    setState(next);
    // Keeps the filters in the address bar so the view can be shared or bookmarked.
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
    void load(next);
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      update({ q: value.trim() });
    }, SEARCH_DELAY_MS);
  }

  function handleSort(column: LeadSortKey) {
    if (state.sort === column) {
      update({ order: state.order === "asc" ? "desc" : "asc" });
      return;
    }

    update({ sort: column, order: column === "name" ? "asc" : "desc" });
  }

  function clearFilters() {
    window.clearTimeout(searchTimerRef.current);
    setSearchInput("");
    update({
      q: "",
      status: "",
      source: "",
      channel: "",
      temperature: "",
      owner: "",
      from: "",
      to: "",
    });
  }

  function resetCreateForm() {
    setCreateName("");
    setCreateEmail("");
    setCreatePhone("");
    setCreateCompany("");
    setCreateIntent("");
    setCreateStatus("NEW");
    setCreateError("");
  }

  function closeCreateModal() {
    if (!isCreating) {
      setShowCreateModal(false);
      setCreateError("");
    }
  }

  async function handleCreateLead() {
    if (isCreating) {
      return;
    }

    setCreateError("");
    const email = createEmail.trim();
    const phone = createPhone.trim();

    if (!email && !phone) {
      setCreateError("Add an email address or phone number so the team can follow up.");
      return;
    }

    if (email && !EMAIL_PATTERN.test(email)) {
      setCreateError("Enter a valid email address, or leave it empty.");
      return;
    }

    const phoneDigits = phone.replace(/\D/g, "");

    if (phone && (phoneDigits.length < 8 || phoneDigits.length > 15)) {
      setCreateError("Enter a valid phone number with country code, or leave it empty.");
      return;
    }

    setIsCreating(true);

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: createName,
          email,
          phone,
          company: createCompany,
          intent: createIntent,
          status: createStatus,
        }),
      });
      const data = await readJson<{
        error?: string;
        created?: boolean;
        lead?: { id: string; name: string | null; email: string | null; phone: string | null };
      }>(response);

      if (!response.ok || !data.lead) {
        setCreateError(data.error ?? "Unable to add the lead right now.");
        return;
      }

      const name = leadDisplayName(data.lead);
      setShowCreateModal(false);
      resetCreateForm();
      setNotice({
        tone: "success",
        text: data.created
          ? `${name} was added as a lead and assigned to you.`
          : `${name} already had an open lead, so it was updated instead of duplicated.`,
        href: `/dashboard/leads/${data.lead.id}`,
      });
      void load(state);
    } catch {
      setCreateError("Something went wrong while adding the lead. Please try again.");
    } finally {
      setIsCreating(false);
    }
  }

  const { leads, total, page, pageSize, pageCount, statusCounts } = list;
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);
  const activeFilterCount = filterKeys.filter((key) => key !== "status" && state[key]).length;
  const hasFilters = activeFilterCount > 0 || Boolean(state.status);
  const allCount = LEAD_STATUSES.reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0);
  const openCount = OPEN_LEAD_STATUSES.reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0);
  const exportQuery = buildQuery(state, { forExport: true });

  const statusTabs = [
    { value: "", label: "All", count: allCount },
    { value: "OPEN", label: "Open", count: openCount },
    ...LEAD_STATUSES.map((status) => ({
      value: status,
      label: leadStatusLabels[status],
      count: statusCounts[status] ?? 0,
    })),
  ];

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">Leads</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-400">
            Everyone who asked to be contacted or showed buying intent in a conversation, on
            any channel.
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <Link href="/dashboard/leads/settings" className={secondaryButtonClass}>
            Settings
          </Link>
          {canExport ? (
            <a
              href={`/api/leads/export${exportQuery ? `?${exportQuery}` : ""}`}
              download
              title="Downloads the leads matching the current filters (up to 5,000)."
              className={secondaryButtonClass}
            >
              Export CSV
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => {
              resetCreateForm();
              setShowCreateModal(true);
            }}
            className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black transition hover:bg-neutral-200"
          >
            Add lead
          </button>
        </div>
      </div>

      <nav aria-label="Lead status" className="mt-6 flex flex-wrap gap-2">
        {statusTabs.map((tab) => {
          const isActive = state.status === tab.value;

          return (
            <button
              key={tab.value || "all"}
              type="button"
              aria-pressed={isActive}
              onClick={() => update({ status: tab.value })}
              className={`pressable inline-flex h-9 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition ${
                isActive
                  ? "border-white bg-white text-[#050505]"
                  : "border-white/10 bg-[#111111] text-white hover:bg-[#191919]"
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
                  isActive ? "bg-black/10 text-[#050505]" : "bg-white/5 text-slate-300"
                }`}
              >
                {tab.count.toLocaleString("en-US")}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-4 flex flex-wrap items-end gap-2.5">
        <div className="inline-flex h-9 w-full items-center rounded-lg border border-white/10 bg-[#111111] px-3 sm:w-auto sm:min-w-[280px]">
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
          <label htmlFor="leads-search" className="sr-only">
            Search leads
          </label>
          <input
            id="leads-search"
            type="search"
            value={searchInput}
            maxLength={120}
            onChange={(event) => handleSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                window.clearTimeout(searchTimerRef.current);
                update({ q: searchInput.trim() });
              }
            }}
            placeholder="Name, email, phone, company or interest"
            className="ml-3 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
        </div>

        <label htmlFor="leads-source" className="sr-only">
          Source
        </label>
        <select
          id="leads-source"
          value={state.source}
          onChange={(event) => update({ source: event.target.value })}
          className={selectClass}
        >
          <option value="">Any source</option>
          {sourceValues.map((value) => (
            <option key={value} value={value}>
              {labelFrom(leadSourceLabels, value)}
            </option>
          ))}
        </select>

        <label htmlFor="leads-channel" className="sr-only">
          Channel
        </label>
        <select
          id="leads-channel"
          value={state.channel}
          onChange={(event) => update({ channel: event.target.value })}
          className={selectClass}
        >
          <option value="">Any channel</option>
          {channelValues.map((value) => (
            <option key={value} value={value}>
              {labelFrom(channelLabels, value)}
            </option>
          ))}
        </select>

        <label htmlFor="leads-temperature" className="sr-only">
          Temperature
        </label>
        <select
          id="leads-temperature"
          value={state.temperature}
          onChange={(event) => update({ temperature: event.target.value })}
          className={selectClass}
        >
          <option value="">Hot, warm and cold</option>
          {temperatureValues.map((value) => (
            <option key={value} value={value}>
              {labelFrom(leadTemperatureLabels, value)}
            </option>
          ))}
        </select>

        <label htmlFor="leads-owner" className="sr-only">
          Owner
        </label>
        <select
          id="leads-owner"
          value={state.owner}
          onChange={(event) => update({ owner: event.target.value })}
          className={selectClass}
        >
          <option value="">Any owner</option>
          <option value="me">Me</option>
          <option value="none">Unassigned</option>
          {users
            .filter((user) => user.id !== currentUserId)
            .map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
        </select>

        <div className="flex items-center gap-2 text-sm text-slate-400">
          <label htmlFor="leads-from">From</label>
          <input
            id="leads-from"
            type="date"
            value={state.from}
            max={state.to || undefined}
            onChange={(event) => update({ from: event.target.value })}
            className={`${selectClass} [color-scheme:dark]`}
          />
          <label htmlFor="leads-to">to</label>
          <input
            id="leads-to"
            type="date"
            value={state.to}
            min={state.from || undefined}
            onChange={(event) => update({ to: event.target.value })}
            className={`${selectClass} [color-scheme:dark]`}
          />
        </div>

        {activeFilterCount > 0 ? (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3.5 text-sm font-medium text-white transition hover:bg-[#191919]"
          >
            Clear filters ({activeFilterCount})
          </button>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            notice.tone === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-200"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {notice.text}
          {notice.href ? (
            <>
              {" "}
              <Link href={notice.href} className="font-semibold underline underline-offset-2">
                View lead
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <p className="mt-5 text-sm text-slate-400" aria-live="polite">
        {pluralLeads(total)}
        {hasFilters ? " match these filters" : ""}
        {isLoading ? (
          <span role="status" className="ml-3 text-xs text-slate-500">
            Loading...
          </span>
        ) : null}
      </p>

      <div
        aria-busy={isLoading}
        className={`mt-3 rounded-[22px] border border-white/10 bg-[#0a0a0a] transition-opacity ${
          isLoading ? "opacity-60" : ""
        }`}
      >
        {leads.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-16 text-center">
            <svg
              viewBox="0 0 24 24"
              className="h-10 w-10 text-slate-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M4 5h16l-6 7.5V19l-4 1.5v-8Z" />
            </svg>
            <p className="mt-4 text-xl text-slate-300">
              {hasFilters ? "No leads match these filters" : "No leads yet"}
            </p>
            {hasFilters ? (
              <p className="mt-2 max-w-md text-sm text-slate-500">
                Try a different search, status or date range.
              </p>
            ) : (
              <p className="mt-2 max-w-lg text-sm text-slate-500">
                Turn on the lead form in{" "}
                <Link href="/dashboard/chatbots" className="text-slate-300 underline underline-offset-2 hover:text-white">
                  Chatbot settings
                </Link>{" "}
                to ask website visitors for their details, or wait for customers to show buying
                intent: AssistDesk detects it in conversations on any channel and saves a lead
                automatically. You can also add one yourself.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1320px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white">
                  <SortHeader label="Name" column="name" state={state} onSort={handleSort} />
                  <th scope="col" className="px-4 py-5 font-semibold">Contact</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Interested in</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Source</th>
                  <SortHeader label="Score" column="score" state={state} onSort={handleSort} />
                  <SortHeader label="Status" column="status" state={state} onSort={handleSort} />
                  <th scope="col" className="px-4 py-5 font-semibold">Owner</th>
                  <SortHeader label="Created" column="createdAt" state={state} onSort={handleSort} />
                  <SortHeader
                    label="Last activity"
                    column="lastActivityAt"
                    state={state}
                    onSort={handleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="relative border-b border-white/10 text-white transition last:border-b-0 hover:bg-white/[0.03]"
                  >
                    <td className="max-w-[220px] px-4 py-4">
                      <Link
                        href={`/dashboard/leads/${lead.id}`}
                        className={`block truncate font-semibold after:absolute after:inset-0 after:content-[''] focus-visible:underline ${
                          lead.name ? "text-white" : "italic text-slate-300"
                        }`}
                      >
                        {leadDisplayName(lead)}
                      </Link>
                      {lead.company ? (
                        <p className="mt-0.5 truncate text-xs text-slate-400">{lead.company}</p>
                      ) : null}
                    </td>
                    <td className="max-w-[240px] px-4 py-4 text-slate-300">
                      {lead.email ? <p className="truncate">{lead.email}</p> : null}
                      {lead.phone ? (
                        <p className="truncate text-xs text-slate-400">{lead.phone}</p>
                      ) : null}
                      {!lead.email && !lead.phone ? <span className="text-slate-500">—</span> : null}
                    </td>
                    <td className="max-w-[260px] px-4 py-4 text-slate-300">
                      {lead.intent ? (
                        <p className="truncate" title={lead.intent}>
                          {lead.intent}
                        </p>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        <span className={leadSourceBadgeClass()}>
                          {labelFrom(leadSourceLabels, lead.source)}
                        </span>
                        <span className={channelBadgeClass(lead.channel)}>
                          {labelFrom(channelLabels, lead.channel)}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <span className={leadTemperatureBadgeClass(lead.temperature)}>
                        {labelFrom(leadTemperatureLabels, lead.temperature)} · {lead.score}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <span className={leadStatusBadgeClass(lead.status)}>
                        {leadStatusLabels[lead.status]}
                      </span>
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-4 text-slate-300">
                      {lead.owner ? (
                        lead.owner.id === currentUserId ? `${lead.owner.fullName} (you)` : lead.owner.fullName
                      ) : (
                        <span className="text-slate-500">Unassigned</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-300">
                      <RelativeTime value={lead.createdAt} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-300">
                      <RelativeTime value={lead.lastActivityAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-4 text-sm text-slate-300 xl:flex-row xl:items-center xl:justify-between">
        <p aria-live="polite">
          Showing {firstItem}–{lastItem} of {pluralLeads(total)}
        </p>

        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <label htmlFor="leads-page-size">Rows per page</label>
            <select
              id="leads-page-size"
              value={state.pageSize}
              onChange={(event) => update({ pageSize: Number(event.target.value) })}
              className={selectClass}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-white">
              Page {page} of {pageCount}
            </span>
            <div className="flex items-center gap-2">
              {[
                { label: "‹ Prev", ariaLabel: "Previous page", target: page - 1, disabled: page <= 1 },
                { label: "Next ›", ariaLabel: "Next page", target: page + 1, disabled: page >= pageCount },
              ].map((item) => (
                <button
                  key={item.ariaLabel}
                  type="button"
                  aria-label={item.ariaLabel}
                  disabled={item.disabled || isLoading}
                  onClick={() => update({ page: item.target })}
                  className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-slate-300 transition hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showCreateModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 px-4 py-6"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closeCreateModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-lead-title"
            className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0b0b0b] p-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">New lead</p>
                <h2
                  id="create-lead-title"
                  className="heading-font mt-1 text-2xl font-semibold text-white"
                >
                  Add a lead
                </h2>
              </div>
              <button
                type="button"
                disabled={isCreating}
                onClick={closeCreateModal}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <p className="mt-3 text-sm text-slate-400">
              For someone who contacted you outside AssistDesk. An email or phone number is
              required; if the customer already has an open lead, it is updated instead.
            </p>

            <form
              className="mt-6 grid gap-4 md:grid-cols-2"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateLead();
              }}
            >
              <div>
                <label htmlFor="create-lead-name" className="mb-2 block text-sm font-medium text-white">
                  Name
                </label>
                <input
                  id="create-lead-name"
                  type="text"
                  maxLength={120}
                  autoFocus
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="create-lead-company" className="mb-2 block text-sm font-medium text-white">
                  Company
                </label>
                <input
                  id="create-lead-company"
                  type="text"
                  maxLength={120}
                  value={createCompany}
                  onChange={(event) => setCreateCompany(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="create-lead-email" className="mb-2 block text-sm font-medium text-white">
                  Email
                </label>
                <input
                  id="create-lead-email"
                  type="email"
                  maxLength={160}
                  value={createEmail}
                  onChange={(event) => setCreateEmail(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="create-lead-phone" className="mb-2 block text-sm font-medium text-white">
                  Phone
                </label>
                <input
                  id="create-lead-phone"
                  type="tel"
                  maxLength={32}
                  placeholder="+92 300 1234567"
                  value={createPhone}
                  onChange={(event) => setCreatePhone(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="create-lead-intent" className="mb-2 block text-sm font-medium text-white">
                  Interested in
                </label>
                <input
                  id="create-lead-intent"
                  type="text"
                  maxLength={400}
                  placeholder="e.g. Pricing for the annual plan"
                  value={createIntent}
                  onChange={(event) => setCreateIntent(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="create-lead-status" className="mb-2 block text-sm font-medium text-white">
                  Status
                </label>
                <select
                  id="create-lead-status"
                  value={createStatus}
                  onChange={(event) => setCreateStatus(event.target.value as LeadStatusValue)}
                  className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none"
                >
                  {LEAD_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {leadStatusLabels[status]}
                    </option>
                  ))}
                </select>
              </div>

              {createError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 md:col-span-2"
                >
                  {createError}
                </p>
              ) : null}

              <div className="flex justify-end gap-3 md:col-span-2">
                <button
                  type="button"
                  disabled={isCreating}
                  onClick={closeCreateModal}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] disabled:bg-neutral-400"
                >
                  {isCreating ? "Adding..." : "Add lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
