"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DashboardPageHeader } from "./dashboard-page-header";

type TicketItem = {
  id: string;
  ticketNumber: number;
  subject: string;
  previewText: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  source: string;
  status: string;
  priority: string;
  createdAt: string;
  assigneeName: string | null;
  assigneeInitials: string;
  tags: string[];
};

type TicketsClientProps = {
  initialTickets: TicketItem[];
};

type MenuName = "priority" | "status" | "source" | null;
type ViewMode = "list" | "grid";

const priorityOptions = ["ALL", "LOW", "MEDIUM", "HIGH", "URGENT"];
const statusOptions = ["ALL", "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const sourceOptions = ["ALL", "WEB", "EMAIL", "MANUAL"];

function formatTicketDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

function formatOptionLabel(value: string) {
  if (value === "ALL") {
    return "All";
  }

  return value.toLowerCase().replaceAll("_", " ");
}

function formatSource(source: string) {
  return source.toLowerCase().replace("_", " ");
}

function statusClass(status: string) {
  if (status === "OPEN") {
    return "rounded-full border border-[#22355b] bg-[#10192d] px-2.5 py-1 text-xs font-medium text-white";
  }

  if (status === "IN_PROGRESS") {
    return "rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200";
  }

  if (status === "RESOLVED") {
    return "rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-200";
  }

  return "rounded-full border border-white/10 bg-[#161616] px-2.5 py-1 text-xs font-medium capitalize text-white";
}

function priorityClass(priority: string) {
  if (priority === "URGENT") {
    return "rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-200";
  }

  if (priority === "HIGH") {
    return "rounded-full bg-orange-500/15 px-2.5 py-1 text-xs font-medium text-orange-200";
  }

  if (priority === "LOW") {
    return "rounded-full bg-slate-500/15 px-2.5 py-1 text-xs font-medium text-slate-200";
  }

  return "rounded-full bg-[#1f1f1f] px-2.5 py-1 text-xs font-medium text-white";
}

function TicketToolbarButton({
  label,
  value,
  isActive,
  onClick,
}: {
  label: string;
  value?: string;
  isActive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition ${
        isActive
          ? "border-white bg-white text-[#050505]"
          : "border-white/10 bg-[#111111] text-white hover:bg-[#191919]"
      }`}
    >
      <span className="text-xs">{label}</span>
      {value ? (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            isActive
              ? "bg-black/10 text-[#050505]"
              : "bg-white/5 text-slate-300"
          }`}
        >
          {value}
        </span>
      ) : null}
    </button>
  );
}

function FilterMenu({
  label,
  options,
  selectedValue,
  onSelect,
}: {
  label: string;
  options: string[];
  selectedValue: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="absolute left-0 top-[calc(100%+8px)] z-20 min-w-[180px] rounded-xl border border-white/10 bg-[#0d0d0d] p-2 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
      <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <div className="space-y-1">
        {options.map((option) => {
          const isSelected = selectedValue === option;

          return (
            <button
              key={option}
              type="button"
              onClick={() => onSelect(option)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                isSelected
                  ? "bg-white text-[#050505]"
                  : "text-slate-200 hover:bg-white/5"
              }`}
            >
              <span className="capitalize">{formatOptionLabel(option)}</span>
              {isSelected ? <span className="text-xs">Selected</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TicketsClient({ initialTickets }: TicketsClientProps) {
  const router = useRouter();
  const [tickets, setTickets] = useState(
    [...initialTickets].sort((a, b) => b.ticketNumber - a.ticketNumber),
  );
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [sourceFilter, setSourceFilter] = useState<string>("ALL");
  const [view, setView] = useState<ViewMode>("list");
  const [openMenu, setOpenMenu] = useState<MenuName>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [subject, setSubject] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [createPriority, setCreatePriority] = useState("MEDIUM");
  const [createStatus, setCreateStatus] = useState("OPEN");
  const [createSource, setCreateSource] = useState("WEB");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      const searchValue = search.toLowerCase();
      const matchesSearch =
        !searchValue ||
        ticket.subject.toLowerCase().includes(searchValue) ||
        ticket.previewText?.toLowerCase().includes(searchValue) ||
        ticket.requesterName?.toLowerCase().includes(searchValue) ||
        ticket.requesterEmail?.toLowerCase().includes(searchValue) ||
        ticket.ticketNumber.toString().includes(searchValue);

      const matchesPriority =
        priorityFilter === "ALL" || ticket.priority === priorityFilter;
      const matchesStatus =
        statusFilter === "ALL" || ticket.status === statusFilter;
      const matchesSource =
        sourceFilter === "ALL" || ticket.source === sourceFilter;

      return matchesSearch && matchesPriority && matchesStatus && matchesSource;
    });
  }, [tickets, search, priorityFilter, sourceFilter, statusFilter]);

  async function handleCreateTicket() {
    setError("");

    if (!subject.trim()) {
      setError("Please enter a subject for the ticket.");
      return;
    }

    const response = await fetch("/api/tickets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject,
        previewText,
        requesterName,
        requesterEmail,
        priority: createPriority,
        status: createStatus,
        source: createSource,
      }),
    });

    const data = (await response.json()) as {
      error?: string;
      ticket?: {
        id: string;
        ticketNumber: number;
        subject: string;
        previewText: string | null;
        requesterName: string | null;
        requesterEmail: string | null;
        source: string;
        status: string;
        priority: string;
        createdAt: string;
        assignee?: { fullName: string | null } | null;
      };
    };

    if (!response.ok || !data.ticket) {
      setError(data.error ?? "Unable to create ticket right now.");
      return;
    }

    const newTicket: TicketItem = {
      id: data.ticket.id,
      ticketNumber: data.ticket.ticketNumber,
      subject: data.ticket.subject,
      previewText: data.ticket.previewText,
      requesterName: data.ticket.requesterName,
      requesterEmail: data.ticket.requesterEmail,
      source: data.ticket.source,
      status: data.ticket.status,
      priority: data.ticket.priority,
      createdAt: data.ticket.createdAt,
      assigneeName: data.ticket.assignee?.fullName ?? "Unassigned",
      assigneeInitials: (data.ticket.assignee?.fullName ?? "UN")
        .split(" ")
        .map((part) => part[0])
        .slice(0, 2)
        .join(""),
      tags: [],
    };

    setTickets((current) =>
      [...current, newTicket].sort((a, b) => b.ticketNumber - a.ticketNumber),
    );
    setShowCreateModal(false);
    setSubject("");
    setPreviewText("");
    setRequesterName("");
    setRequesterEmail("");
    setCreatePriority("MEDIUM");
    setCreateStatus("OPEN");
    setCreateSource("WEB");
    setSearch("");

    startTransition(() => {
      router.refresh();
    });
  }

  function clearFilters() {
    setSearch("");
    setPriorityFilter("ALL");
    setStatusFilter("ALL");
    setSourceFilter("ALL");
    setOpenMenu(null);
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <DashboardPageHeader
        title="Tickets"
        actionLabel="Create Ticket"
        actionStyle="light"
        onActionClick={() => setShowCreateModal(true)}
      />

      <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-wrap gap-2.5">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 min-w-[220px] rounded-lg border border-white/10 bg-[#0d0d0d] px-4 text-sm text-white outline-none transition focus:border-white"
          />

          <div className="relative">
            <TicketToolbarButton
              label="Priority"
              value={formatOptionLabel(priorityFilter)}
              isActive={openMenu === "priority" || priorityFilter !== "ALL"}
              onClick={() =>
                setOpenMenu((current) =>
                  current === "priority" ? null : "priority",
                )
              }
            />
            {openMenu === "priority" ? (
              <FilterMenu
                label="Priority"
                options={priorityOptions}
                selectedValue={priorityFilter}
                onSelect={(value) => {
                  setPriorityFilter(value);
                  setOpenMenu(null);
                }}
              />
            ) : null}
          </div>

          <div className="relative">
            <TicketToolbarButton
              label="Status"
              value={formatOptionLabel(statusFilter)}
              isActive={openMenu === "status" || statusFilter !== "ALL"}
              onClick={() =>
                setOpenMenu((current) =>
                  current === "status" ? null : "status",
                )
              }
            />
            {openMenu === "status" ? (
              <FilterMenu
                label="Status"
                options={statusOptions}
                selectedValue={statusFilter}
                onSelect={(value) => {
                  setStatusFilter(value);
                  setOpenMenu(null);
                }}
              />
            ) : null}
          </div>

          <div className="relative">
            <TicketToolbarButton
              label="Source"
              value={formatOptionLabel(sourceFilter)}
              isActive={openMenu === "source" || sourceFilter !== "ALL"}
              onClick={() =>
                setOpenMenu((current) =>
                  current === "source" ? null : "source",
                )
              }
            />
            {openMenu === "source" ? (
              <FilterMenu
                label="Source"
                options={sourceOptions}
                selectedValue={sourceFilter}
                onSelect={(value) => {
                  setSourceFilter(value);
                  setOpenMenu(null);
                }}
              />
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5 xl:justify-end">
          <TicketToolbarButton
            label="Filter"
            value={`${filteredTickets.length}`}
            isActive={
              priorityFilter !== "ALL" ||
              statusFilter !== "ALL" ||
              sourceFilter !== "ALL"
            }
            onClick={clearFilters}
          />

          <button
            type="button"
            onClick={() => setView("grid")}
            className={`inline-flex h-9 items-center justify-center rounded-lg border px-3.5 text-sm font-medium transition ${
              view === "grid"
                ? "border-white bg-white text-[#050505]"
                : "border-white/10 bg-[#111111] text-white hover:bg-[#191919]"
            }`}
          >
            Grid
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={`inline-flex h-9 items-center justify-center rounded-lg border px-3.5 text-sm font-medium transition ${
              view === "list"
                ? "border-white bg-white text-[#050505]"
                : "border-white/10 bg-[#111111] text-white hover:bg-[#191919]"
            }`}
          >
            List
          </button>
        </div>
      </div>

      <div
        className={`mt-5 ${
          view === "grid" ? "grid gap-4 lg:grid-cols-2" : "space-y-3"
        }`}
      >
        {filteredTickets.map((ticket) =>
          view === "grid" ? (
            <section
              key={ticket.id}
              className="rounded-2xl border border-white/10 bg-[#080808] p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <span className="font-semibold text-white">
                      #{ticket.ticketNumber}
                    </span>
                    <span className="rounded-lg border border-white/10 bg-[#111111] px-2 py-0.5 text-[11px] text-white">
                      {formatSource(ticket.source)}
                    </span>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-white">
                    {ticket.subject}
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {ticket.previewText ?? "No preview available"}
                  </p>
                </div>
                <button type="button" className="text-lg text-slate-500">
                  ...
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className={priorityClass(ticket.priority)}>
                  {formatOptionLabel(ticket.priority)}
                </span>
                <span className={statusClass(ticket.status)}>
                  {formatOptionLabel(ticket.status)}
                </span>
                {ticket.tags.map((tag) => (
                  <span
                    key={`${ticket.id}-${tag}`}
                    className="rounded-full border border-white/10 bg-[#151515] px-2.5 py-1 text-xs font-medium text-slate-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1b1b1b] text-xs font-semibold text-white">
                    {(ticket.requesterName ?? "U").charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {ticket.requesterName ?? "Unknown requester"}
                    </p>
                    <p className="text-xs text-slate-400">
                      {ticket.requesterEmail ?? "No email added"}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-xs text-slate-400">
                    {formatTicketDate(ticket.createdAt)}
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {ticket.assigneeName ?? "Unassigned"}
                  </p>
                </div>
              </div>
            </section>
          ) : (
            <section
              key={ticket.id}
              className="rounded-2xl border border-white/10 bg-[#080808]"
            >
              <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 text-sm text-slate-300">
                    <span className="h-4 w-4 rounded border border-white/20" />
                    <span className="font-semibold text-white">
                      #{ticket.ticketNumber}
                    </span>
                    <span className="rounded-lg border border-white/10 bg-[#111111] px-2 py-0.5 text-[11px] text-white">
                      {formatSource(ticket.source)}
                    </span>
                  </div>

                  <div className="mt-3 space-y-1">
                    <h2 className="text-lg font-semibold text-white">
                      {ticket.subject}
                    </h2>
                    <p className="text-sm text-slate-400">
                      {ticket.previewText ?? "No preview available"}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className={priorityClass(ticket.priority)}>
                      {formatOptionLabel(ticket.priority)}
                    </span>
                    <span className={statusClass(ticket.status)}>
                      {formatOptionLabel(ticket.status)}
                    </span>
                    {ticket.tags.map((tag) => (
                      <span
                        key={`${ticket.id}-${tag}`}
                        className="rounded-full border border-white/10 bg-[#151515] px-2.5 py-1 text-xs font-medium text-slate-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1b1b1b] text-xs font-semibold text-white">
                      {(ticket.requesterName ?? "U").charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <p className="text-sm text-white">
                        {ticket.requesterName ?? "Unknown requester"}
                      </p>
                      <p className="text-xs text-slate-400">
                        {ticket.requesterEmail ?? "No email added"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex min-w-[210px] flex-col items-start gap-16 text-sm lg:items-end">
                  <button type="button" className="text-lg text-slate-400">
                    ...
                  </button>

                  <div className="space-y-3 text-left lg:text-right">
                    <p className="text-slate-400">
                      {formatTicketDate(ticket.createdAt)}
                    </p>
                    <div className="flex items-center gap-3 lg:justify-end">
                      <span className="text-slate-400">Assigned to:</span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1f1f1f] text-xs font-semibold text-white">
                        {ticket.assigneeInitials}
                      </span>
                      <span className="font-semibold text-white">
                        {ticket.assigneeName ?? "Unassigned"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ),
        )}

        {filteredTickets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-[#080808] p-10 text-center text-sm text-slate-400">
            No tickets match the current search or filters.
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex flex-col gap-4 text-sm text-slate-300 xl:flex-row xl:items-center xl:justify-between">
        <p>
          Showing {filteredTickets.length} ticket
          {filteredTickets.length === 1 ? "" : "s"} in {view} view.
        </p>

        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <span>Rows per page</span>
            <div className="inline-flex h-9 items-center rounded-lg border border-white/10 bg-[#111111] px-4 text-white">
              20
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-medium text-white">Page 1 of 1</span>
            <div className="flex items-center gap-2">
              {["<<", "<", ">", ">>"].map((item) => (
                <button
                  key={item}
                  type="button"
                  className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3 text-xs text-slate-300"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0b0b0b] p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">New Ticket</p>
                <h2 className="heading-font mt-1 text-2xl font-semibold text-white">
                  Create a support ticket
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <input
                type="text"
                placeholder="Ticket subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white md:col-span-2"
              />
              <input
                type="text"
                placeholder="Requester name"
                value={requesterName}
                onChange={(event) => setRequesterName(event.target.value)}
                className="rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
              />
              <input
                type="email"
                placeholder="Requester email"
                value={requesterEmail}
                onChange={(event) => setRequesterEmail(event.target.value)}
                className="rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
              />
              <textarea
                placeholder="Ticket preview or details"
                value={previewText}
                onChange={(event) => setPreviewText(event.target.value)}
                className="min-h-[110px] rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white md:col-span-2"
              />
              <select
                value={createPriority}
                onChange={(event) => setCreatePriority(event.target.value)}
                className="rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none"
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
              <select
                value={createStatus}
                onChange={(event) => setCreateStatus(event.target.value)}
                className="rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none"
              >
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="RESOLVED">Resolved</option>
                <option value="CLOSED">Closed</option>
              </select>
              <select
                value={createSource}
                onChange={(event) => setCreateSource(event.target.value)}
                className="rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none md:col-span-2"
              >
                <option value="WEB">Web</option>
                <option value="EMAIL">Email</option>
                <option value="MANUAL">Manual</option>
              </select>
            </div>

            {error ? (
              <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleCreateTicket}
                className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] disabled:bg-neutral-400"
              >
                {isPending ? "Saving..." : "Create Ticket"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
