"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { channelBadgeClass, channelLabels, labelFrom } from "@/src/lib/contact-labels";
import type { LeadDetail } from "@/src/lib/lead-detail";
import {
  LEAD_STATUSES,
  leadSourceLabels,
  leadStatusLabels,
  type LeadStatusValue,
} from "@/src/lib/lead-form";
import {
  leadDisplayName,
  leadEventDotClass,
  leadEventLabels,
  leadSourceBadgeClass,
  leadStatusBadgeClass,
  leadTemperatureBadgeClass,
  leadTemperatureLabels,
  webhookDeliveryBadgeClass,
  webhookDeliveryStatusLabels,
} from "@/src/lib/lead-labels";
import { RelativeTime } from "./notifications-bell";

type LeadDetailWorkspaceProps = {
  initialDetail: LeadDetail;
  users: Array<{ id: string; fullName: string }>;
  currentUserId: string;
  timeZone: string;
  canDelete: boolean;
  canResend: boolean;
};

type Notice = {
  tone: "success" | "error" | "warning";
  text: string;
};

type EditableKey = "name" | "email" | "phone" | "company" | "intent";
type Drafts = Record<EditableKey, string>;
type LeadRecord = LeadDetail["lead"];

const MAX_NOTE_LENGTH = 2000;

const editableFields: Array<{
  key: EditableKey;
  label: string;
  type: string;
  maxLength: number;
  placeholder?: string;
}> = [
  { key: "name", label: "Name", type: "text", maxLength: 120 },
  { key: "company", label: "Company", type: "text", maxLength: 120 },
  { key: "email", label: "Email", type: "email", maxLength: 160 },
  { key: "phone", label: "Phone", type: "tel", maxLength: 32, placeholder: "+92 300 1234567" },
  {
    key: "intent",
    label: "Interested in",
    type: "text",
    maxLength: 400,
    placeholder: "e.g. Pricing for the annual plan",
  },
];

const senderLabels: Record<string, string> = {
  USER: "Customer",
  AI: "AI assistant",
  AGENT: "Team",
};

const selectClass =
  "h-9 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white outline-none transition focus:border-white disabled:opacity-60";
const secondaryButtonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-60";
const primaryButtonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg bg-white px-3.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400";
const linkClass =
  "text-sm font-medium text-white underline decoration-white/30 underline-offset-4 transition hover:decoration-white";

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

// Formatted in the workspace time zone so server and client output match (UI-19).
function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function draftsFrom(lead: LeadRecord): Drafts {
  return {
    name: lead.name ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    company: lead.company ?? "",
    intent: lead.intent ?? "",
  };
}

function NoticeMessage({ notice }: { notice: Notice | null }) {
  if (!notice) {
    return null;
  }

  const toneClass =
    notice.tone === "error"
      ? "border-red-500/30 bg-red-500/10 text-red-200"
      : notice.tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";

  return (
    <p
      role={notice.tone === "success" ? "status" : "alert"}
      className={`mt-4 rounded-xl border px-4 py-3 text-sm ${toneClass}`}
    >
      {notice.text}
    </p>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-200">{children}</dd>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <span className="text-slate-500">{children}</span>;
}

const scoreRules = [
  {
    title: "Reachable",
    text: "Email +20, phone number +15.",
  },
  {
    title: "Identified",
    text: "Name +5, company +10, each answer to a custom form question +5 (up to 15).",
  },
  {
    title: "Engaged",
    text: "Buying intent in the conversation +20, 4 or more customer messages +5, 8 or more +5, returning customer +10.",
  },
  {
    title: "Consent",
    text: "Agreed to marketing messages +5.",
  },
];

export function LeadDetailWorkspace({
  initialDetail,
  users,
  currentUserId,
  timeZone,
  canDelete,
  canResend,
}: LeadDetailWorkspaceProps) {
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);
  const { lead, events, deliveries, conversation, otherLeads } = detail;

  const [headerNotice, setHeaderNotice] = useState<Notice | null>(null);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [isSavingOwner, setIsSavingOwner] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFrom(initialDetail.lead));
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [detailsNotice, setDetailsNotice] = useState<Notice | null>(null);

  const [noteDraft, setNoteDraft] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteError, setNoteError] = useState("");

  const [isResending, setIsResending] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState<Notice | null>(null);

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const displayName = leadDisplayName(lead);
  const noteTooLong = noteDraft.length > MAX_NOTE_LENGTH;

  async function refreshDetail() {
    try {
      const response = await fetch(`/api/leads/${lead.id}`, { cache: "no-store" });

      if (!response.ok) {
        return;
      }

      const data = await readJson<Partial<LeadDetail>>(response);

      if (data.lead && data.events && data.deliveries && data.conversation && data.otherLeads) {
        setDetail(data as LeadDetail);
      }
    } catch {
      // The page keeps showing what it has; the next action refreshes again.
    }
  }

  async function patchLead(payload: Record<string, string | null>) {
    const response = await fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await readJson<{ error?: string; warning?: string; lead?: LeadRecord }>(response);

    if (!response.ok || !data.lead) {
      throw new Error(data.error ?? "Unable to update this lead.");
    }

    return { lead: data.lead, warning: data.warning ?? null };
  }

  /** Status and owner change optimistically and roll back if the server refuses. */
  async function handleQuickChange(
    field: "status" | "ownerId",
    value: string | null,
    optimistic: Partial<LeadRecord>,
    successText: string,
  ) {
    const previous = lead;
    const setSaving = field === "status" ? setIsSavingStatus : setIsSavingOwner;

    setHeaderNotice(null);
    setSaving(true);
    setDetail((current) => ({ ...current, lead: { ...current.lead, ...optimistic } }));

    try {
      const result = await patchLead({ [field]: value });
      setDetail((current) => ({ ...current, lead: result.lead }));
      setHeaderNotice({ tone: "success", text: successText });
      await refreshDetail();
    } catch (error) {
      setDetail((current) => ({ ...current, lead: previous }));
      setHeaderNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to update this lead.",
      });
    } finally {
      setSaving(false);
    }
  }

  function handleStatusChange(status: LeadStatusValue) {
    if (status === lead.status) {
      return;
    }

    void handleQuickChange(
      "status",
      status,
      { status },
      `Status changed to ${leadStatusLabels[status]}.`,
    );
  }

  function handleOwnerChange(ownerId: string) {
    const owner = users.find((user) => user.id === ownerId) ?? null;

    if ((lead.owner?.id ?? "") === ownerId) {
      return;
    }

    void handleQuickChange(
      "ownerId",
      ownerId || null,
      { owner: owner ? { id: owner.id, fullName: owner.fullName } : null },
      owner ? `Assigned to ${owner.fullName}.` : "Lead is now unassigned.",
    );
  }

  async function handleSaveDetails() {
    const original = draftsFrom(lead);
    const payload: Record<string, string | null> = {};

    for (const field of editableFields) {
      const value = drafts[field.key].trim();

      if (value !== original[field.key]) {
        payload[field.key] = value || null;
      }
    }

    if (Object.keys(payload).length === 0) {
      setIsEditing(false);
      return;
    }

    setDetailsNotice(null);
    setIsSavingDetails(true);

    try {
      const result = await patchLead(payload);
      setDetail((current) => ({ ...current, lead: result.lead }));
      setDrafts(draftsFrom(result.lead));
      setIsEditing(false);
      setDetailsNotice(
        result.warning
          ? { tone: "warning", text: result.warning }
          : { tone: "success", text: "Details saved." },
      );
      await refreshDetail();
    } catch (error) {
      setDetailsNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Something went wrong while saving.",
      });
    } finally {
      setIsSavingDetails(false);
    }
  }

  async function handleAddNote() {
    const text = noteDraft.trim();
    setNoteError("");

    if (!text) {
      setNoteError("Write a note first.");
      return;
    }

    if (noteTooLong) {
      setNoteError(`Notes can be up to ${MAX_NOTE_LENGTH} characters.`);
      return;
    }

    setIsSavingNote(true);

    try {
      const response = await fetch(`/api/leads/${lead.id}/notes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });
      const data = await readJson<{ error?: string; event?: LeadDetail["events"][number] }>(response);

      if (!response.ok || !data.event) {
        setNoteError(data.error ?? "Unable to add the note.");
        return;
      }

      const event = data.event;
      setDetail((current) => ({ ...current, events: [event, ...current.events] }));
      setNoteDraft("");
    } catch {
      setNoteError("Something went wrong while adding the note.");
    } finally {
      setIsSavingNote(false);
    }
  }

  async function handleResend() {
    setDeliveryNotice(null);
    setIsResending(true);

    try {
      const response = await fetch(`/api/leads/${lead.id}/resend`, { method: "POST" });
      const data = await readJson<{ error?: string; queued?: number }>(response);

      if (!response.ok) {
        setDeliveryNotice({ tone: "error", text: data.error ?? "Unable to send this lead again." });
        return;
      }

      const queued = data.queued ?? 0;
      setDeliveryNotice({
        tone: "success",
        text:
          queued === 1
            ? "Queued for 1 webhook. The result appears here in a few seconds."
            : `Queued for ${queued} webhooks. The results appear here in a few seconds.`,
      });
      await refreshDetail();
    } catch {
      setDeliveryNotice({ tone: "error", text: "Something went wrong while sending the lead again." });
    } finally {
      setIsResending(false);
    }
  }

  async function handleDelete() {
    const shouldDelete = window.confirm(
      `Delete the lead for ${displayName}? Its notes and history are removed. The customer and their conversations are kept. This cannot be undone.`,
    );

    if (!shouldDelete) {
      return;
    }

    setDeleteError("");
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/leads/${lead.id}`, { method: "DELETE" });
      const data = await readJson<{ error?: string }>(response);

      if (!response.ok) {
        setDeleteError(data.error ?? "Unable to delete this lead.");
        setIsDeleting(false);
        return;
      }

      router.push("/dashboard/leads");
    } catch {
      setDeleteError("Something went wrong while deleting this lead.");
      setIsDeleting(false);
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <Link href="/dashboard/leads" className="text-sm text-slate-400 transition hover:text-white">
            &larr; Leads
          </Link>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1
              className={`heading-font break-words text-[2.15rem] font-bold leading-none ${
                lead.name ? "text-white" : "italic text-slate-300"
              }`}
            >
              {displayName}
            </h1>
            <span
              className={leadTemperatureBadgeClass(lead.temperature)}
              title="Lead score out of 100"
            >
              {labelFrom(leadTemperatureLabels, lead.temperature)} · {lead.score}
            </span>
            <span className={leadStatusBadgeClass(lead.status)}>{leadStatusLabels[lead.status]}</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-300">
            {lead.company ? <span>{lead.company}</span> : null}
            {lead.email ? <span>{lead.email}</span> : null}
            {lead.phone ? <span>{lead.phone}</span> : null}
            <span className="flex flex-wrap items-center gap-1.5">
              <span className={leadSourceBadgeClass()}>{labelFrom(leadSourceLabels, lead.source)}</span>
              <span className={channelBadgeClass(lead.channel)}>
                {labelFrom(channelLabels, lead.channel)}
              </span>
            </span>
          </div>

          <p className="mt-3 text-sm text-slate-400">
            Captured {formatDateTime(lead.createdAt, timeZone)} · Last activity{" "}
            <RelativeTime value={lead.lastActivityAt} />
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="lead-status" className="mb-1 block text-xs font-medium text-slate-400">
              Status
            </label>
            <select
              id="lead-status"
              value={lead.status}
              disabled={isSavingStatus}
              onChange={(event) => handleStatusChange(event.target.value as LeadStatusValue)}
              className={`${selectClass} min-w-[150px]`}
            >
              {LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {leadStatusLabels[status]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="lead-owner" className="mb-1 block text-xs font-medium text-slate-400">
              Owner
            </label>
            <select
              id="lead-owner"
              value={lead.owner?.id ?? ""}
              disabled={isSavingOwner}
              onChange={(event) => handleOwnerChange(event.target.value)}
              className={`${selectClass} min-w-[190px]`}
            >
              <option value="">Unassigned</option>
              {lead.owner && !users.some((user) => user.id === lead.owner?.id) ? (
                <option value={lead.owner.id}>{lead.owner.fullName} (inactive)</option>
              ) : null}
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.id === currentUserId ? `${user.fullName} (you)` : user.fullName}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <NoticeMessage notice={headerNotice} />

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-[1.4rem] font-semibold text-white">Details</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-400">
                  What the customer shared. Corrections are logged on the timeline and sent to
                  your webhooks.
                </p>
              </div>
              {!isEditing ? (
                <button
                  type="button"
                  onClick={() => {
                    setDetailsNotice(null);
                    setDrafts(draftsFrom(lead));
                    setIsEditing(true);
                  }}
                  className={secondaryButtonClass}
                >
                  Edit
                </button>
              ) : null}
            </div>

            {isEditing ? (
              <form
                className="mt-5 grid gap-4 md:grid-cols-2"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSaveDetails();
                }}
              >
                {editableFields.map((field) => (
                  <div key={field.key} className={field.key === "intent" ? "md:col-span-2" : undefined}>
                    <label
                      htmlFor={`lead-${field.key}`}
                      className="mb-2 block text-sm font-medium text-white"
                    >
                      {field.label}
                    </label>
                    <input
                      id={`lead-${field.key}`}
                      type={field.type}
                      maxLength={field.maxLength}
                      placeholder={field.placeholder}
                      value={drafts[field.key]}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-2.5 text-sm text-white outline-none transition focus:border-white"
                    />
                  </div>
                ))}
                <div className="flex justify-end gap-2 md:col-span-2">
                  <button
                    type="button"
                    disabled={isSavingDetails}
                    onClick={() => {
                      setIsEditing(false);
                      setDrafts(draftsFrom(lead));
                      setDetailsNotice(null);
                    }}
                    className={secondaryButtonClass}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={isSavingDetails} className={primaryButtonClass}>
                    {isSavingDetails ? "Saving..." : "Save"}
                  </button>
                </div>
              </form>
            ) : (
              <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <DetailRow label="Name">{lead.name ?? <Empty>Not given</Empty>}</DetailRow>
                <DetailRow label="Company">{lead.company ?? <Empty>Not given</Empty>}</DetailRow>
                <DetailRow label="Email">
                  {lead.email ? (
                    <a href={`mailto:${lead.email}`} className="hover:underline">
                      {lead.email}
                    </a>
                  ) : (
                    <Empty>Not given</Empty>
                  )}
                </DetailRow>
                <DetailRow label="Phone">
                  {lead.phone ? (
                    <a href={`tel:${lead.phone}`} className="hover:underline">
                      {lead.phone}
                    </a>
                  ) : (
                    <Empty>Not given</Empty>
                  )}
                </DetailRow>
                <div className="sm:col-span-2">
                  <DetailRow label="Interested in">
                    {lead.intent ? (
                      <span className="whitespace-pre-wrap">{lead.intent}</span>
                    ) : (
                      <Empty>Not detected yet</Empty>
                    )}
                  </DetailRow>
                </div>
                <DetailRow label="Marketing consent">
                  {lead.marketingConsent ? (
                    <span className="text-emerald-200">Yes, agreed to marketing messages</span>
                  ) : (
                    "No"
                  )}
                </DetailRow>
                <DetailRow label="Source">
                  {labelFrom(leadSourceLabels, lead.source)} on {labelFrom(channelLabels, lead.channel)}
                </DetailRow>
                <DetailRow label="Chatbot">
                  {lead.chatbot ? (
                    <Link href={`/dashboard/chatbots/${lead.chatbot.id}`} className="hover:underline">
                      {lead.chatbot.name}
                    </Link>
                  ) : (
                    <Empty>—</Empty>
                  )}
                </DetailRow>
                <DetailRow label="Website">{lead.pageHost ?? <Empty>—</Empty>}</DetailRow>
                <DetailRow label="Created">{formatDateTime(lead.createdAt, timeZone)}</DetailRow>
                <DetailRow label="Last activity">
                  {formatDateTime(lead.lastActivityAt, timeZone)}
                </DetailRow>
              </dl>
            )}

            <NoticeMessage notice={detailsNotice} />

            {lead.fields.length > 0 ? (
              <div className="mt-6 border-t border-white/10 pt-5">
                <h3 className="text-sm font-semibold text-white">Form answers</h3>
                <dl className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  {lead.fields.map((field) => (
                    <DetailRow key={field.key} label={field.label}>
                      {field.value ? (
                        <span className="whitespace-pre-wrap">{field.value}</span>
                      ) : (
                        <Empty>—</Empty>
                      )}
                    </DetailRow>
                  ))}
                </dl>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
              <h2 className="text-[1.4rem] font-semibold text-white">Conversation</h2>
              <div className="flex flex-wrap gap-4">
                {lead.contact ? (
                  <Link href={`/dashboard/contacts/${lead.contact.id}`} className={linkClass}>
                    View customer
                  </Link>
                ) : null}
                {lead.session ? (
                  <Link
                    href={`/dashboard/chats?session=${encodeURIComponent(lead.session.id)}`}
                    className={linkClass}
                  >
                    Open in Chats
                  </Link>
                ) : null}
              </div>
            </div>

            {lead.session ? (
              <p className="mt-2 text-sm text-slate-400">
                {labelFrom(channelLabels, lead.session.channel)} conversation started{" "}
                {formatDateTime(lead.session.startedAt, timeZone)}
                {conversation.length > 0 ? ` · last ${conversation.length} messages` : ""}
              </p>
            ) : null}

            {!lead.session ? (
              <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-[#080808] px-5 py-6 text-sm text-slate-400">
                This lead was added by the team, so there is no conversation attached.
              </div>
            ) : conversation.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-[#080808] px-5 py-6 text-sm text-slate-400">
                No messages in this conversation.
              </div>
            ) : (
              <ol className="mt-5 max-h-[520px] space-y-3 overflow-y-auto pr-1">
                {conversation.map((message) => {
                  const fromCustomer = message.sender === "USER";

                  return (
                    <li
                      key={message.id}
                      className={`flex ${fromCustomer ? "justify-start" : "justify-end"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                          fromCustomer
                            ? "rounded-bl-md bg-[#1f1f1f] text-slate-100"
                            : message.sender === "AGENT"
                              ? "rounded-br-md bg-sky-500/15 text-sky-50"
                              : "rounded-br-md bg-violet-500/15 text-violet-50"
                        }`}
                      >
                        <p className="text-[11px] font-medium text-slate-400">
                          {message.sender === "AGENT" && message.authorName
                            ? message.authorName
                            : labelFrom(senderLabels, message.sender)}
                          {" · "}
                          <RelativeTime value={message.createdAt} />
                        </p>
                        <p className="mt-1 line-clamp-6 whitespace-pre-wrap break-words text-sm leading-6">
                          {message.content}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <h2 className="text-[1.4rem] font-semibold text-white">Activity</h2>

            <form
              className="mt-5"
              onSubmit={(event) => {
                event.preventDefault();
                void handleAddNote();
              }}
            >
              <label htmlFor="lead-note" className="sr-only">
                Add a note
              </label>
              <textarea
                id="lead-note"
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder="Add a note for the team, e.g. Called on Monday, sending a quote."
                aria-describedby="lead-note-count"
                aria-invalid={noteTooLong}
                className={`min-h-[96px] w-full resize-y rounded-xl border bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white ${
                  noteTooLong ? "border-red-500/60" : "border-white/10"
                }`}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <p
                  id="lead-note-count"
                  className={`text-xs tabular-nums ${noteTooLong ? "text-red-300" : "text-slate-500"}`}
                >
                  {noteDraft.length.toLocaleString("en-US")} / {MAX_NOTE_LENGTH.toLocaleString("en-US")}
                </p>
                <button
                  type="submit"
                  disabled={isSavingNote || noteTooLong || !noteDraft.trim()}
                  className={primaryButtonClass}
                >
                  {isSavingNote ? "Adding..." : "Add note"}
                </button>
              </div>
              {noteError ? (
                <p
                  role="alert"
                  className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                >
                  {noteError}
                </p>
              ) : null}
            </form>

            {events.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-[#080808] px-5 py-6 text-sm text-slate-400">
                No activity recorded yet.
              </div>
            ) : (
              <ol className="mt-6 max-h-[640px] space-y-4 overflow-y-auto pr-1">
                {events.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${leadEventDotClass(event.type)}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white">
                        {labelFrom(leadEventLabels, event.type)}
                      </p>
                      {event.detail ? (
                        event.type === "NOTE" ? (
                          <p className="mt-1 whitespace-pre-wrap break-words rounded-xl bg-[#1a1a1a] px-4 py-3 text-sm leading-6 text-slate-200">
                            {event.detail}
                          </p>
                        ) : (
                          <p className="mt-0.5 break-words text-sm text-slate-400">{event.detail}</p>
                        )
                      ) : null}
                      <p className="mt-0.5 text-xs text-slate-500">
                        {event.actorName ? `${event.actorName} · ` : ""}
                        <RelativeTime value={event.createdAt} />
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[1.4rem] font-semibold text-white">Score</h2>
              <span className={leadTemperatureBadgeClass(lead.temperature)}>
                {labelFrom(leadTemperatureLabels, lead.temperature)} · {lead.score} / 100
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              A priority for follow-up, recalculated whenever the customer comes back. Hot is
              70 or more, warm 40 to 69, cold below 40.
            </p>
            <ul className="mt-4 space-y-3">
              {scoreRules.map((rule) => (
                <li key={rule.title} className="text-sm">
                  <span className="font-medium text-white">{rule.title}</span>
                  <span className="text-slate-400"> — {rule.text}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-[1.4rem] font-semibold text-white">Webhook deliveries</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Copies of this lead sent to your CRM or other tools.
                </p>
              </div>
              {canResend ? (
                <button
                  type="button"
                  disabled={isResending}
                  onClick={() => void handleResend()}
                  className={`${secondaryButtonClass} shrink-0`}
                >
                  {isResending ? "Sending..." : "Send to webhooks again"}
                </button>
              ) : null}
            </div>

            <NoticeMessage notice={deliveryNotice} />

            {deliveries.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-[#080808] px-5 py-6 text-sm text-slate-400">
                Not sent to any webhook yet. Webhooks are set up in{" "}
                <Link href="/dashboard/leads/settings" className="text-slate-200 underline underline-offset-2 hover:text-white">
                  Lead settings
                </Link>
                .
              </div>
            ) : (
              <ul className="mt-5 space-y-3">
                {deliveries.map((delivery) => (
                  <li
                    key={delivery.id}
                    className="rounded-xl border border-white/10 bg-[#111111] px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium text-white">
                        {delivery.endpoint.name}
                      </span>
                      <span className={webhookDeliveryBadgeClass(delivery.status)}>
                        {delivery.status === "RETRYING" && delivery.nextAttemptAt
                          ? `Retrying at ${formatDateTime(delivery.nextAttemptAt, timeZone)}`
                          : labelFrom(webhookDeliveryStatusLabels, delivery.status)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-400">
                      <code className="text-slate-300">{delivery.event}</code>
                      {` · ${delivery.attempts} ${delivery.attempts === 1 ? "attempt" : "attempts"}`}
                      {delivery.responseStatus ? ` · HTTP ${delivery.responseStatus}` : ""}
                      {" · "}
                      {formatDateTime(delivery.deliveredAt ?? delivery.createdAt, timeZone)}
                    </p>
                    {delivery.error ? (
                      <p className="mt-1.5 break-words text-xs text-red-200">{delivery.error}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {otherLeads.length > 0 ? (
            <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
              <h2 className="text-[1.4rem] font-semibold text-white">Other leads from this customer</h2>
              <ul className="mt-5 space-y-3">
                {otherLeads.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/dashboard/leads/${item.id}`}
                      className="block rounded-xl border border-white/10 bg-[#111111] px-4 py-3 transition hover:border-white/20 hover:bg-[#161616]"
                    >
                      <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                        <span className={leadStatusBadgeClass(item.status)}>
                          {leadStatusLabels[item.status]}
                        </span>
                        <span>{formatDateTime(item.createdAt, timeZone)}</span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 break-words text-sm text-slate-200">
                        {item.intent ?? "No interest recorded"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {canDelete ? (
            <section className="rounded-2xl border border-red-500/30 bg-red-500/[0.04] p-6">
              <h2 className="text-[1.4rem] font-semibold text-red-100">Danger zone</h2>
              <p className="mt-1 text-sm text-slate-400">
                Delete this lead for a privacy request or if it is spam. The customer record and
                their conversations are not affected.
              </p>

              {deleteError ? (
                <p
                  role="alert"
                  className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                >
                  {deleteError}
                </p>
              ) : null}

              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleDelete()}
                className="pressable mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/15 px-4 text-sm font-semibold text-red-100 transition hover:bg-red-500/25 disabled:opacity-60"
              >
                {isDeleting ? "Deleting..." : "Delete lead"}
              </button>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
