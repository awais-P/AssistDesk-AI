"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { formatTicketLabel } from "@/src/lib/canned-variables";
import { DashboardPageHeader } from "./dashboard-page-header";

export type TicketSort = "newest" | "oldest" | "updated" | "priority";

export type TicketFilters = {
  q: string;
  status: string;
  priority: string;
  source: string;
  assignee: string;
  inbox: string;
  tag: string;
};

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
  inboxName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeInitials: string;
  tags: string[];
};

type NamedOption = {
  id: string;
  name: string;
};

type TicketsClientProps = {
  tickets: TicketItem[];
  total: number;
  page: number;
  pageSize: number;
  sort: TicketSort;
  filters: TicketFilters;
  users: Array<{ id: string; fullName: string }>;
  inboxes: NamedOption[];
  tags: NamedOption[];
  timeZone: string;
  currentUser: {
    id: string;
    fullName: string;
  };
};

type FilterKey = Exclude<keyof TicketFilters, "q">;
type MenuName = FilterKey | null;
type ViewMode = "list" | "grid";
type BulkAction = "status" | "priority" | "assign" | "tag" | "delete";

type Option = {
  value: string;
  label: string;
};

type ListState = TicketFilters & {
  page: number;
  pageSize: number;
  sort: TicketSort;
};

const priorityValues = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const statusValues = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const sourceValues = ["WEB", "EMAIL", "WHATSAPP", "SLACK", "VOICE", "MANUAL"];
const createSourceValues = ["WEB", "EMAIL", "MANUAL"];
const pageSizeOptions = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;

const sortOptions: Array<{ value: TicketSort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "updated", label: "Recently updated" },
  { value: "priority", label: "Highest priority" },
];

const filterKeys: FilterKey[] = ["priority", "status", "source", "assignee", "inbox", "tag"];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const selectClass =
  "h-9 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white outline-none transition focus:border-white disabled:opacity-60";

function enumOptions(values: string[]): Option[] {
  return [
    { value: "", label: "All" },
    ...values.map((value) => ({ value, label: formatTicketLabel(value) })),
  ];
}

// Dates are formatted in the workspace time zone so server and client render the
// same text (UI-19).
function formatTicketDate(date: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone,
  }).format(new Date(date));
}

function formatDetailedDate(date: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(date));
}

function statusClass(status: string) {
  if (status === "OPEN") {
    return "rounded-full border border-[#22355b] bg-[#10192d] px-2.5 py-1 text-xs font-medium text-white";
  }

  if (status === "IN_PROGRESS") {
    return "rounded-full border border-[#29438c] bg-[#16254d] px-2.5 py-1 text-xs font-medium text-blue-100";
  }

  if (status === "RESOLVED") {
    return "rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-200";
  }

  if (status === "CLOSED") {
    return "rounded-full border border-white/10 bg-[#171717] px-2.5 py-1 text-xs font-medium text-slate-300";
  }

  return "rounded-full border border-white/10 bg-[#161616] px-2.5 py-1 text-xs font-medium text-white";
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

function buildQuery(state: ListState) {
  const params = new URLSearchParams();

  if (state.q) {
    params.set("q", state.q);
  }

  for (const key of filterKeys) {
    if (state[key]) {
      params.set(key, state[key]);
    }
  }

  if (state.sort !== "newest") {
    params.set("sort", state.sort);
  }

  if (state.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set("pageSize", String(state.pageSize));
  }

  if (state.page > 1) {
    params.set("page", String(state.page));
  }

  return params.toString();
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function pluralTickets(count: number) {
  return `${count} ticket${count === 1 ? "" : "s"}`;
}

function TicketToolbarButton({
  label,
  value,
  isActive,
  isExpanded,
  onClick,
}: {
  label: string;
  value?: string;
  isActive?: boolean;
  isExpanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup={isExpanded === undefined ? undefined : "true"}
      aria-expanded={isExpanded}
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
  options: Option[];
  selectedValue: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="absolute left-0 top-[calc(100%+8px)] z-20 max-h-80 min-w-[190px] overflow-y-auto rounded-xl border border-white/10 bg-[#0d0d0d] p-2 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
      <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <div className="space-y-1">
        {options.map((option) => {
          const isSelected = selectedValue === option.value;

          return (
            <button
              key={option.value || "all"}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(option.value)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                isSelected
                  ? "bg-white text-[#050505]"
                  : "text-slate-200 hover:bg-white/5"
              }`}
            >
              <span>{option.label}</span>
              {isSelected ? <span className="text-xs">Selected</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BulkSelect({
  id,
  label,
  options,
  disabled,
  onChoose,
}: {
  id: string;
  label: string;
  options: Option[];
  disabled: boolean;
  onChoose: (value: string) => void;
}) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value=""
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value) {
            onChoose(event.target.value);
          }
        }}
        className={selectClass}
      >
        <option value="" disabled>
          {label}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </>
  );
}

function TicketActionMenu({
  ticket,
  users,
  isBusy,
  onCopyId,
  onViewDetails,
  onAssignToMe,
  onChangeStatus,
  onReassign,
  onCloseTicket,
  onDeleteTicket,
}: {
  ticket: TicketItem;
  users: TicketsClientProps["users"];
  isBusy: boolean;
  onCopyId: () => void;
  onViewDetails: () => void;
  onAssignToMe: () => void;
  onChangeStatus: (status: string) => void;
  onReassign: (assigneeId: string) => void;
  onCloseTicket: () => void;
  onDeleteTicket: () => void;
}) {
  const menuItems = [
    { label: "Copy ticket ID", action: onCopyId },
    { label: "View details", action: onViewDetails },
    { label: "Assign to me", action: onAssignToMe },
    { label: "Close this ticket", action: onCloseTicket },
  ];

  return (
    <div className="absolute right-0 top-11 z-30 w-[220px] rounded-xl border border-white/10 bg-[#131313] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.42)]">
      <p className="px-2 pb-2 pt-1 text-sm font-semibold text-white">Actions</p>
      <div className="space-y-1">
        {menuItems.map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={isBusy}
            onClick={item.action}
            className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {item.label}
          </button>
        ))}

        <div className="px-3 py-2">
          <label
            htmlFor={`ticket-${ticket.id}-status`}
            className="block text-xs font-medium text-slate-400"
          >
            Change status
          </label>
          <select
            id={`ticket-${ticket.id}-status`}
            value={ticket.status}
            disabled={isBusy}
            onChange={(event) => onChangeStatus(event.target.value)}
            className={`${selectClass} mt-1 w-full`}
          >
            {statusValues.map((status) => (
              <option key={status} value={status}>
                {formatTicketLabel(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="px-3 py-2">
          <label
            htmlFor={`ticket-${ticket.id}-assignee`}
            className="block text-xs font-medium text-slate-400"
          >
            Reassign to
          </label>
          <select
            id={`ticket-${ticket.id}-assignee`}
            value={ticket.assigneeId ?? ""}
            disabled={isBusy}
            onChange={(event) => onReassign(event.target.value)}
            className={`${selectClass} mt-1 w-full`}
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          disabled={isBusy}
          onClick={onDeleteTicket}
          className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Delete Ticket
        </button>
      </div>
    </div>
  );
}

export function TicketsClient({
  tickets,
  total,
  page,
  pageSize,
  sort,
  filters,
  users,
  inboxes,
  tags,
  timeZone,
  currentUser,
}: TicketsClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchInput, setSearchInput] = useState(filters.q);
  const [view, setView] = useState<ViewMode>("list");
  const [openMenu, setOpenMenu] = useState<MenuName>(null);
  const [ticketMenuId, setTicketMenuId] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [subject, setSubject] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [createPriority, setCreatePriority] = useState("MEDIUM");
  const [createStatus, setCreateStatus] = useState("OPEN");
  const [createSource, setCreateSource] = useState("WEB");
  const [createError, setCreateError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [actioningTicketId, setActioningTicketId] = useState("");
  const [isBulkPending, setIsBulkPending] = useState(false);
  const [isPending, startTransition] = useTransition();
  const searchTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    function closeMenus() {
      setOpenMenu(null);
      setTicketMenuId("");
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenus();
      }
    }

    window.addEventListener("click", closeMenus);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", closeMenus);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const timer = searchTimerRef;
    return () => window.clearTimeout(timer.current);
  }, []);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);
  const selectedTickets = tickets.filter((ticket) => selectedIds.has(ticket.id));
  const allSelected = tickets.length > 0 && selectedTickets.length === tickets.length;
  const someSelected = selectedTickets.length > 0 && !allSelected;
  const activeFilterCount =
    filterKeys.filter((key) => filters[key]).length + (filters.q ? 1 : 0);

  const userOptions: Option[] = users.map((user) => ({
    value: user.id,
    label: user.id === currentUser.id ? `${user.fullName} (you)` : user.fullName,
  }));
  const tagOptions: Option[] = tags.map((tag) => ({ value: tag.id, label: tag.name }));

  const filterMenus: Array<{ key: FilterKey; label: string; options: Option[] }> = [
    { key: "priority", label: "Priority", options: enumOptions(priorityValues) },
    { key: "status", label: "Status", options: enumOptions(statusValues) },
    // "State" in the SRS means the channel a ticket arrived through (UI-33).
    { key: "source", label: "Channel", options: enumOptions(sourceValues) },
    {
      key: "assignee",
      label: "Assignee",
      options: [
        { value: "", label: "All" },
        { value: "unassigned", label: "Unassigned" },
        ...userOptions,
      ],
    },
    {
      key: "inbox",
      label: "Inbox",
      options: [
        { value: "", label: "All" },
        { value: "unassigned", label: "No inbox" },
        ...inboxes.map((inbox) => ({ value: inbox.id, label: inbox.name })),
      ],
    },
    {
      key: "tag",
      label: "Tags",
      options: [{ value: "", label: "All" }, ...tagOptions],
    },
  ];

  function navigate(changes: Partial<ListState>) {
    const next: ListState = { ...filters, sort, pageSize, page: 1, ...changes };
    const query = buildQuery(next);

    setSelectedIds(new Set());
    setOpenMenu(null);
    setTicketMenuId("");
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      navigate({ q: value.trim() });
    }, 350);
  }

  function clearFilters() {
    window.clearTimeout(searchTimerRef.current);
    setSearchInput("");
    navigate({
      q: "",
      status: "",
      priority: "",
      source: "",
      assignee: "",
      inbox: "",
      tag: "",
    });
  }

  function toggleSelected(ticketId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(ticketId)) {
        next.delete(ticketId);
      } else {
        next.add(ticketId);
      }

      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(tickets.map((ticket) => ticket.id)));
  }

  function refreshList() {
    startTransition(() => {
      router.refresh();
    });
  }

  async function patchTicket(ticketId: string, payload: Record<string, unknown>) {
    const response = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await readJson<{ error?: string }>(response);

    if (!response.ok) {
      throw new Error(data.error ?? "Unable to update the ticket.");
    }
  }

  async function runRowAction(ticket: TicketItem, work: () => Promise<string>) {
    setError("");
    setSuccess("");
    setTicketMenuId("");
    setActioningTicketId(ticket.id);

    try {
      setSuccess(await work());
      refreshList();
    } catch (actionError) {
      setError(errorMessage(actionError, "Unable to process that ticket action."));
    } finally {
      setActioningTicketId("");
    }
  }

  async function handleCopyId(ticket: TicketItem) {
    setError("");
    setSuccess("");
    setTicketMenuId("");

    try {
      await navigator.clipboard.writeText(`#${ticket.ticketNumber}`);
      setSuccess(`Copied #${ticket.ticketNumber} to your clipboard.`);
    } catch {
      setError("Unable to copy the ticket ID right now.");
    }
  }

  function handleDeleteTicket(ticket: TicketItem) {
    const shouldDelete = window.confirm(
      `Delete ticket #${ticket.ticketNumber}? This cannot be undone.`,
    );

    if (!shouldDelete) {
      return;
    }

    void runRowAction(ticket, async () => {
      const response = await fetch(`/api/tickets/${ticket.id}`, {
        method: "DELETE",
      });
      const data = await readJson<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to delete this ticket.");
      }

      return `Ticket #${ticket.ticketNumber} deleted successfully.`;
    });
  }

  async function runBulkAction(action: BulkAction, value?: string) {
    const ids = selectedTickets.map((ticket) => ticket.id);

    if (ids.length === 0 || isBulkPending) {
      return;
    }

    if (
      action === "delete" &&
      !window.confirm(`Delete ${pluralTickets(ids.length)}? This cannot be undone.`)
    ) {
      return;
    }

    setError("");
    setSuccess("");
    setIsBulkPending(true);

    try {
      const response = await fetch("/api/tickets/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids, action, value }),
      });
      const data = await readJson<{ error?: string; updated?: number }>(response);

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to apply that bulk action.");
      }

      const updated = data.updated ?? 0;
      const unchanged = ids.length - updated;

      setSelectedIds(new Set());
      setSuccess(
        action === "delete"
          ? `${pluralTickets(updated)} deleted.`
          : `${pluralTickets(updated)} updated${
              unchanged > 0 ? ` (${unchanged} already had that value)` : ""
            }.`,
      );
      refreshList();
    } catch (bulkError) {
      setError(errorMessage(bulkError, "Unable to apply that bulk action."));
    } finally {
      setIsBulkPending(false);
    }
  }

  function closeCreateModal() {
    if (isCreating) {
      return;
    }

    setShowCreateModal(false);
    setCreateError("");
  }

  async function handleCreateTicket() {
    if (isCreating) {
      return;
    }

    setCreateError("");
    setError("");
    setSuccess("");

    if (!subject.trim()) {
      setCreateError("Please enter a subject for the ticket.");
      return;
    }

    if (requesterEmail.trim() && !EMAIL_PATTERN.test(requesterEmail.trim())) {
      setCreateError("Enter a valid requester email address, or leave it empty.");
      return;
    }

    setIsCreating(true);

    try {
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

      const data = await readJson<{
        error?: string;
        ticket?: { ticketNumber: number } | null;
      }>(response);

      if (!response.ok || !data.ticket) {
        setCreateError(data.error ?? "Unable to create the ticket right now.");
        return;
      }

      setShowCreateModal(false);
      setSubject("");
      setPreviewText("");
      setRequesterName("");
      setRequesterEmail("");
      setCreatePriority("MEDIUM");
      setCreateStatus("OPEN");
      setCreateSource("WEB");
      setSuccess(`Ticket #${data.ticket.ticketNumber} created successfully.`);
      refreshList();
    } catch {
      setCreateError("Something went wrong while creating the ticket. Please try again.");
    } finally {
      setIsCreating(false);
    }
  }

  function renderSelectBox(ticket: TicketItem) {
    return (
      <input
        type="checkbox"
        checked={selectedIds.has(ticket.id)}
        onChange={() => toggleSelected(ticket.id)}
        onClick={(event) => event.stopPropagation()}
        aria-label={`Select ticket #${ticket.ticketNumber}`}
        className="h-4 w-4 cursor-pointer accent-white"
      />
    );
  }

  function renderRowMenu(ticket: TicketItem) {
    const isBusy = actioningTicketId === ticket.id;

    return (
      <div className="relative" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          aria-label={`Actions for ticket #${ticket.ticketNumber}`}
          aria-haspopup="true"
          aria-expanded={ticketMenuId === ticket.id}
          disabled={isBusy}
          onClick={() => {
            setOpenMenu(null);
            setTicketMenuId((current) => (current === ticket.id ? "" : ticket.id));
          }}
          className="rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-lg leading-none text-slate-400 transition hover:bg-[#1a1a1a] disabled:opacity-60"
        >
          {isBusy ? "…" : "..."}
        </button>

        {ticketMenuId === ticket.id ? (
          <TicketActionMenu
            ticket={ticket}
            users={users}
            isBusy={isBusy}
            onCopyId={() => void handleCopyId(ticket)}
            onViewDetails={() => router.push(`/dashboard/tickets/${ticket.id}`)}
            onAssignToMe={() =>
              void runRowAction(ticket, async () => {
                await patchTicket(ticket.id, { assignToMe: true });
                return `Ticket #${ticket.ticketNumber} assigned to you.`;
              })
            }
            onChangeStatus={(status) =>
              void runRowAction(ticket, async () => {
                await patchTicket(ticket.id, { status });
                return `Ticket #${ticket.ticketNumber} is now ${formatTicketLabel(status)}.`;
              })
            }
            onReassign={(assigneeId) =>
              void runRowAction(ticket, async () => {
                await patchTicket(ticket.id, { assigneeId: assigneeId || null });
                const assignee = users.find((user) => user.id === assigneeId);
                return assignee
                  ? `Ticket #${ticket.ticketNumber} assigned to ${assignee.fullName}.`
                  : `Ticket #${ticket.ticketNumber} is now unassigned.`;
              })
            }
            onCloseTicket={() =>
              void runRowAction(ticket, async () => {
                await patchTicket(ticket.id, { status: "CLOSED" });
                return `Ticket #${ticket.ticketNumber} closed successfully.`;
              })
            }
            onDeleteTicket={() => handleDeleteTicket(ticket)}
          />
        ) : null}
      </div>
    );
  }

  function renderBadges(ticket: TicketItem) {
    return (
      <div className="mt-4 flex flex-wrap gap-2">
        <span className={priorityClass(ticket.priority)}>
          {formatTicketLabel(ticket.priority)}
        </span>
        <span className={statusClass(ticket.status)}>
          {formatTicketLabel(ticket.status)}
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
    );
  }

  function renderRequester(ticket: TicketItem) {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1b1b1b] text-xs font-semibold text-white">
          {(ticket.requesterName ?? "U").charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">
            {ticket.requesterName ?? "Unknown requester"}
          </p>
          <p className="truncate text-xs text-slate-400">
            {ticket.requesterEmail ?? "No email added"}
          </p>
        </div>
      </div>
    );
  }

  const isBusyList = isPending || isBulkPending;

  return (
    <div className="px-5 py-4 md:px-6">
      <DashboardPageHeader
        title="Tickets"
        actionLabel="Create Ticket"
        actionStyle="light"
        onActionClick={() => {
          setCreateError("");
          setShowCreateModal(true);
        }}
      />

      <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-wrap gap-2.5">
          <label htmlFor="ticket-search" className="sr-only">
            Search tickets
          </label>
          <input
            id="ticket-search"
            type="search"
            placeholder="Search subject, ticket #, customer..."
            value={searchInput}
            onChange={(event) => handleSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                window.clearTimeout(searchTimerRef.current);
                navigate({ q: searchInput.trim() });
              }
            }}
            className="h-9 w-full rounded-lg border border-white/10 bg-[#0d0d0d] px-4 text-sm text-white outline-none transition focus:border-white sm:w-auto sm:min-w-[260px]"
          />

          {filterMenus.map((item) => {
            const value = filters[item.key];
            const selectedLabel =
              item.options.find((option) => option.value === value)?.label ?? "All";

            return (
              // Clicks inside the chip must not reach the window listener that
              // closes menus, or the menu closes in the same click (BUG-01).
              <div
                key={item.key}
                className="relative"
                onClick={(event) => event.stopPropagation()}
              >
                <TicketToolbarButton
                  label={item.label}
                  value={selectedLabel}
                  isActive={openMenu === item.key || value !== ""}
                  isExpanded={openMenu === item.key}
                  onClick={() => {
                    setTicketMenuId("");
                    setOpenMenu((current) => (current === item.key ? null : item.key));
                  }}
                />
                {openMenu === item.key ? (
                  <FilterMenu
                    label={item.label}
                    options={item.options}
                    selectedValue={value}
                    onSelect={(nextValue) => navigate({ [item.key]: nextValue })}
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2.5 xl:justify-end">
          {activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3.5 text-sm font-medium text-white transition hover:bg-[#191919]"
            >
              Clear filters ({activeFilterCount})
            </button>
          ) : null}

          {(["grid", "list"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
              className={`inline-flex h-9 items-center justify-center rounded-lg border px-3.5 text-sm font-medium capitalize transition ${
                view === mode
                  ? "border-white bg-white text-[#050505]"
                  : "border-white/10 bg-[#111111] text-white hover:bg-[#191919]"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </p>
      ) : null}

      {success ? (
        <p
          role="status"
          className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
        >
          {success}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
        <label className="inline-flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(element) => {
              if (element) {
                element.indeterminate = someSelected;
              }
            }}
            disabled={tickets.length === 0}
            onChange={toggleSelectAll}
            className="h-4 w-4 cursor-pointer accent-white"
          />
          Select all on this page
        </label>

        <div className="flex items-center gap-3">
          <label htmlFor="ticket-sort">Sort by</label>
          <select
            id="ticket-sort"
            value={sort}
            onChange={(event) => navigate({ sort: event.target.value as TicketSort })}
            className={selectClass}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedTickets.length > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="mt-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-white/15 bg-[#0d0d0d] px-4 py-3"
        >
          <span className="mr-1 text-sm font-semibold text-white">
            {selectedTickets.length} selected
          </span>
          <BulkSelect
            id="bulk-status"
            label="Set status"
            options={statusValues.map((value) => ({ value, label: formatTicketLabel(value) }))}
            disabled={isBulkPending}
            onChoose={(value) => void runBulkAction("status", value)}
          />
          <BulkSelect
            id="bulk-priority"
            label="Set priority"
            options={priorityValues.map((value) => ({ value, label: formatTicketLabel(value) }))}
            disabled={isBulkPending}
            onChoose={(value) => void runBulkAction("priority", value)}
          />
          <BulkSelect
            id="bulk-assign"
            label="Assign to"
            options={[{ value: "unassigned", label: "Unassigned" }, ...userOptions]}
            disabled={isBulkPending}
            onChoose={(value) => void runBulkAction("assign", value)}
          />
          {tagOptions.length > 0 ? (
            <BulkSelect
              id="bulk-tag"
              label="Add tag"
              options={tagOptions}
              disabled={isBulkPending}
              onChoose={(value) => void runBulkAction("tag", value)}
            />
          ) : null}
          <button
            type="button"
            disabled={isBulkPending}
            onClick={() => void runBulkAction("delete")}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 text-sm font-medium text-red-200 transition hover:bg-red-500/15 disabled:opacity-60"
          >
            Delete
          </button>
          <button
            type="button"
            disabled={isBulkPending}
            onClick={() => setSelectedIds(new Set())}
            className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm text-slate-300 transition hover:text-white disabled:opacity-60"
          >
            Clear selection
          </button>
          {isBulkPending ? (
            <span role="status" className="text-sm text-slate-400">
              Applying...
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        aria-busy={isBusyList}
        className={`mt-5 transition-opacity ${isBusyList ? "opacity-60" : ""} ${
          view === "grid" ? "grid gap-4 lg:grid-cols-2" : "space-y-3"
        }`}
      >
        {tickets.map((ticket) =>
          view === "grid" ? (
            <article
              key={ticket.id}
              onClick={() => router.push(`/dashboard/tickets/${ticket.id}`)}
              className={`relative min-w-0 cursor-pointer rounded-2xl border bg-[#080808] p-5 transition hover:border-white/20 hover:bg-[#0d0d0d] ${
                selectedIds.has(ticket.id) ? "border-white/40" : "border-white/10"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    {renderSelectBox(ticket)}
                    <span className="font-semibold text-white">
                      #{ticket.ticketNumber}
                    </span>
                    <span className="rounded-lg border border-white/10 bg-[#111111] px-2 py-0.5 text-[11px] text-white">
                      {formatTicketLabel(ticket.source)}
                    </span>
                  </div>
                  <h2 className="mt-3 break-words text-lg font-semibold text-white">
                    {ticket.subject}
                  </h2>
                  <p className="mt-1 line-clamp-2 break-words text-sm text-slate-400">
                    {ticket.previewText ?? "No preview available"}
                  </p>
                </div>

                {renderRowMenu(ticket)}
              </div>

              {renderBadges(ticket)}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                {renderRequester(ticket)}

                <div className="text-right">
                  <p className="text-xs text-slate-400">
                    {formatTicketDate(ticket.createdAt, timeZone)}
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {ticket.assigneeName ?? "Unassigned"}
                  </p>
                </div>
              </div>
            </article>
          ) : (
            <article
              key={ticket.id}
              onClick={() => router.push(`/dashboard/tickets/${ticket.id}`)}
              className={`relative min-w-0 cursor-pointer rounded-2xl border bg-[#080808] transition hover:border-white/20 hover:bg-[#0d0d0d] ${
                selectedIds.has(ticket.id) ? "border-white/40" : "border-white/10"
              }`}
            >
              <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 text-sm text-slate-300">
                    {renderSelectBox(ticket)}
                    <span className="font-semibold text-white">
                      #{ticket.ticketNumber}
                    </span>
                    <span className="rounded-lg border border-white/10 bg-[#111111] px-2 py-0.5 text-[11px] text-white">
                      {formatTicketLabel(ticket.source)}
                    </span>
                  </div>

                  <div className="mt-3 space-y-1">
                    <h2 className="break-words text-lg font-semibold text-white">
                      {ticket.subject}
                    </h2>
                    <p className="line-clamp-2 break-words text-sm text-slate-400">
                      {ticket.previewText ?? "No preview available"}
                    </p>
                  </div>

                  {renderBadges(ticket)}

                  <div className="mt-4">{renderRequester(ticket)}</div>
                </div>

                <div className="flex flex-row-reverse items-start justify-between gap-4 text-sm lg:min-w-[210px] lg:flex-col lg:items-end lg:gap-16">
                  {renderRowMenu(ticket)}

                  <div className="space-y-3 text-left lg:text-right">
                    <p className="text-slate-400">
                      {formatDetailedDate(ticket.createdAt, timeZone)}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 lg:justify-end">
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
            </article>
          ),
        )}

        {tickets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-[#080808] p-10 text-center text-sm text-slate-400 lg:col-span-2">
            {activeFilterCount > 0
              ? "No tickets match the current search or filters."
              : "No tickets yet. Create one to get started."}
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex flex-col gap-4 text-sm text-slate-300 xl:flex-row xl:items-center xl:justify-between">
        <p aria-live="polite">
          Showing {firstItem}–{lastItem} of {pluralTickets(total)}
        </p>

        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <label htmlFor="rows-per-page">Rows per page</label>
            <select
              id="rows-per-page"
              value={pageSize}
              onChange={(event) => navigate({ pageSize: Number(event.target.value) })}
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
                { label: "«", ariaLabel: "First page", target: 1, disabled: page <= 1 },
                { label: "‹", ariaLabel: "Previous page", target: page - 1, disabled: page <= 1 },
                { label: "›", ariaLabel: "Next page", target: page + 1, disabled: page >= pageCount },
                { label: "»", ariaLabel: "Last page", target: pageCount, disabled: page >= pageCount },
              ].map((item) => (
                <button
                  key={item.ariaLabel}
                  type="button"
                  aria-label={item.ariaLabel}
                  disabled={item.disabled || isPending}
                  onClick={() => navigate({ page: item.target })}
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
            aria-labelledby="create-ticket-title"
            className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0b0b0b] p-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">New Ticket</p>
                <h2
                  id="create-ticket-title"
                  className="heading-font mt-1 text-2xl font-semibold text-white"
                >
                  Create a support ticket
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

            <form
              className="mt-6 grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateTicket();
              }}
            >
              <div className="md:col-span-2">
                <label htmlFor="create-ticket-subject" className="mb-2 block text-sm font-medium text-white">
                  Subject
                </label>
                <input
                  id="create-ticket-subject"
                  type="text"
                  required
                  maxLength={200}
                  placeholder="What does the customer need help with?"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
                />
              </div>
              <div>
                <label htmlFor="create-ticket-name" className="mb-2 block text-sm font-medium text-white">
                  Requester name
                </label>
                <input
                  id="create-ticket-name"
                  type="text"
                  value={requesterName}
                  onChange={(event) => setRequesterName(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
                />
              </div>
              <div>
                <label htmlFor="create-ticket-email" className="mb-2 block text-sm font-medium text-white">
                  Requester email
                </label>
                <input
                  id="create-ticket-email"
                  type="email"
                  value={requesterEmail}
                  onChange={(event) => setRequesterEmail(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="create-ticket-details" className="mb-2 block text-sm font-medium text-white">
                  Details
                </label>
                <textarea
                  id="create-ticket-details"
                  placeholder="Describe the issue"
                  value={previewText}
                  onChange={(event) => setPreviewText(event.target.value)}
                  className="min-h-[110px] w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
                />
              </div>
              <div>
                <label htmlFor="create-ticket-priority" className="mb-2 block text-sm font-medium text-white">
                  Priority
                </label>
                <select
                  id="create-ticket-priority"
                  value={createPriority}
                  onChange={(event) => setCreatePriority(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none"
                >
                  {priorityValues.map((value) => (
                    <option key={value} value={value}>
                      {formatTicketLabel(value)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="create-ticket-status" className="mb-2 block text-sm font-medium text-white">
                  Status
                </label>
                <select
                  id="create-ticket-status"
                  value={createStatus}
                  onChange={(event) => setCreateStatus(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none"
                >
                  {statusValues.map((value) => (
                    <option key={value} value={value}>
                      {formatTicketLabel(value)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label htmlFor="create-ticket-source" className="mb-2 block text-sm font-medium text-white">
                  Channel
                </label>
                <select
                  id="create-ticket-source"
                  value={createSource}
                  onChange={(event) => setCreateSource(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none"
                >
                  {createSourceValues.map((value) => (
                    <option key={value} value={value}>
                      {formatTicketLabel(value)}
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
                  {isCreating ? "Creating..." : "Create Ticket"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
