"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatTicketLabel } from "@/src/lib/canned-variables";
import {
  channelBadgeClass,
  channelLabels,
  closedReasonLabels,
  contactDisplayName,
  labelFrom,
  resolutionLabels,
  sessionEventLabels,
  sessionStatusLabels,
} from "@/src/lib/contact-labels";
import type { ContactDetail } from "@/src/lib/contact-list";
import { RelativeTime } from "./notifications-bell";

type ContactDetailWorkspaceProps = {
  initialDetail: ContactDetail;
  timeZone: string;
  canErase: boolean;
};

type Notice = {
  tone: "success" | "error";
  text: string;
};

const MAX_MEMORY_LENGTH = 2000;

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

function sessionStatusBadgeClass(status: string) {
  const base = "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold";

  if (status === "ACTIVE") {
    return `${base} bg-emerald-500/15 text-emerald-200`;
  }

  if (status === "ESCALATED") {
    return `${base} bg-amber-500/15 text-amber-200`;
  }

  return `${base} bg-white/10 text-slate-300`;
}

function resolutionBadgeClass(resolution: string) {
  const base = "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium";

  if (resolution === "AI_RESOLVED") {
    return `${base} bg-violet-500/15 text-violet-200`;
  }

  if (resolution === "HUMAN_HANDLED") {
    return `${base} bg-sky-500/15 text-sky-200`;
  }

  return `${base} bg-red-500/10 text-red-200`;
}

function ticketStatusBadgeClass(status: string) {
  const base = "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold";

  if (status === "OPEN") {
    return `${base} bg-emerald-500 text-white`;
  }

  if (status === "IN_PROGRESS") {
    return `${base} bg-[#1b3d8b] text-blue-100`;
  }

  if (status === "RESOLVED") {
    return `${base} bg-emerald-500/15 text-emerald-200`;
  }

  return `${base} bg-white/10 text-slate-300`;
}

function priorityBadgeClass(priority: string) {
  const base = "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold";

  if (priority === "URGENT") {
    return `${base} bg-red-500/15 text-red-200`;
  }

  if (priority === "HIGH") {
    return `${base} bg-orange-500/15 text-orange-200`;
  }

  if (priority === "LOW") {
    return `${base} bg-slate-500/15 text-slate-200`;
  }

  return `${base} bg-[#1f1f1f] text-white`;
}

function eventDotClass(type: string) {
  if (type === "RATE_LIMITED" || type === "AI_LIMIT_REACHED" || type === "AI_FALLBACK_REPLY") {
    return "bg-amber-400";
  }

  if (type === "HUMAN_TAKEOVER" || type === "AI_RESUMED") {
    return "bg-sky-400";
  }

  if (type === "CONTEXT_CARRIED" || type === "SESSION_RESUMED" || type === "MEMORY_EDITED") {
    return "bg-violet-400";
  }

  if (type === "CHANNEL_LINKED" || type === "CONTACTS_MERGED" || type === "CONTACT_CREATED") {
    return "bg-emerald-400";
  }

  return "bg-slate-500";
}

function NoticeMessage({ notice }: { notice: Notice | null }) {
  if (!notice) {
    return null;
  }

  return notice.tone === "error" ? (
    <p
      role="alert"
      className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
    >
      {notice.text}
    </p>
  ) : (
    <p
      role="status"
      className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
    >
      {notice.text}
    </p>
  );
}

const secondaryButtonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-60";
const primaryButtonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg bg-white px-3.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400";

export function ContactDetailWorkspace({
  initialDetail,
  timeZone,
  canErase,
}: ContactDetailWorkspaceProps) {
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);
  const { contact, sessions, tickets, events } = detail;

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(contact.name ?? "");
  const [isSavingName, setIsSavingName] = useState(false);
  const [headerNotice, setHeaderNotice] = useState<Notice | null>(null);

  const [isEditingMemory, setIsEditingMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState(contact.memory ?? "");
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [memoryNotice, setMemoryNotice] = useState<Notice | null>(null);

  const [eraseConversations, setEraseConversations] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [eraseError, setEraseError] = useState("");

  const displayName = contactDisplayName(contact);
  const sessionIds = new Set(sessions.map((item) => item.id));
  const memoryTooLong = memoryDraft.length > MAX_MEMORY_LENGTH;

  async function refreshDetail() {
    const response = await fetch(`/api/contacts/${contact.id}`, { cache: "no-store" });

    if (!response.ok) {
      return;
    }

    const data = await readJson<ContactDetail>(response);

    if (data.contact) {
      setDetail(data);
    }
  }

  async function patchContact(payload: { name?: string | null; memory?: string | null }) {
    const response = await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await readJson<{ error?: string }>(response);

    if (!response.ok) {
      return data.error ?? "Unable to update this customer.";
    }

    await refreshDetail();
    return null;
  }

  async function handleSaveName() {
    setHeaderNotice(null);
    setIsSavingName(true);

    try {
      const failure = await patchContact({ name: nameDraft.trim() || null });

      if (failure) {
        setHeaderNotice({ tone: "error", text: failure });
        return;
      }

      setIsEditingName(false);
      setHeaderNotice({ tone: "success", text: "Name updated." });
    } catch {
      setHeaderNotice({ tone: "error", text: "Something went wrong while saving the name." });
    } finally {
      setIsSavingName(false);
    }
  }

  async function handleSaveMemory() {
    setMemoryNotice(null);

    if (memoryTooLong) {
      setMemoryNotice({
        tone: "error",
        text: `Memory can be up to ${MAX_MEMORY_LENGTH} characters.`,
      });
      return;
    }

    setIsSavingMemory(true);

    try {
      const failure = await patchContact({ memory: memoryDraft.trim() || null });

      if (failure) {
        setMemoryNotice({ tone: "error", text: failure });
        return;
      }

      setIsEditingMemory(false);
      setMemoryNotice({ tone: "success", text: "Memory saved. The assistant uses it from the next message." });
    } catch {
      setMemoryNotice({ tone: "error", text: "Something went wrong while saving the memory." });
    } finally {
      setIsSavingMemory(false);
    }
  }

  async function handleClearMemory() {
    const shouldClear = window.confirm(
      `Clear the AI memory for ${displayName}? The assistant forgets this profile until their next conversation ends and it is rebuilt.`,
    );

    if (!shouldClear) {
      return;
    }

    setMemoryNotice(null);
    setIsSavingMemory(true);

    try {
      const failure = await patchContact({ memory: null });

      if (failure) {
        setMemoryNotice({ tone: "error", text: failure });
        return;
      }

      setIsEditingMemory(false);
      setMemoryDraft("");
      setMemoryNotice({ tone: "success", text: "Memory cleared." });
    } catch {
      setMemoryNotice({ tone: "error", text: "Something went wrong while clearing the memory." });
    } finally {
      setIsSavingMemory(false);
    }
  }

  async function handleErase() {
    const shouldErase = window.confirm(
      eraseConversations
        ? `Forget ${displayName} and permanently delete their chat conversations? Tickets stay but are unlinked. This cannot be undone.`
        : `Forget ${displayName}? Their conversations are kept but anonymised, tickets stay but are unlinked, and the assistant loses its memory of them. This cannot be undone.`,
    );

    if (!shouldErase) {
      return;
    }

    setEraseError("");
    setIsErasing(true);

    try {
      const response = await fetch(
        `/api/contacts/${contact.id}${eraseConversations ? "?erase=conversations" : ""}`,
        { method: "DELETE" },
      );
      const data = await readJson<{ error?: string }>(response);

      if (!response.ok) {
        setEraseError(data.error ?? "Unable to forget this customer.");
        setIsErasing(false);
        return;
      }

      router.push("/dashboard/contacts");
    } catch {
      setEraseError("Something went wrong while forgetting this customer.");
      setIsErasing(false);
    }
  }

  const identifierChips = [
    contact.identifiers.webVisitor ? "WEB_WIDGET" : null,
    contact.identifiers.whatsapp ? "WHATSAPP" : null,
    contact.identifiers.slack ? "SLACK" : null,
    contact.identifiers.email ? "EMAIL" : null,
  ].filter((channel): channel is string => Boolean(channel));

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <Link
            href="/dashboard/contacts"
            className="text-sm text-slate-400 transition hover:text-white"
          >
            &larr; Contacts
          </Link>

          {isEditingName ? (
            <form
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveName();
              }}
            >
              <label htmlFor="contact-name" className="sr-only">
                Customer name
              </label>
              <input
                id="contact-name"
                type="text"
                value={nameDraft}
                maxLength={120}
                autoFocus
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setIsEditingName(false);
                    setNameDraft(contact.name ?? "");
                  }
                }}
                placeholder="Customer name"
                className="h-11 w-full max-w-sm rounded-xl border border-white/10 bg-[#111111] px-4 text-base text-white outline-none transition focus:border-white"
              />
              <button type="submit" disabled={isSavingName} className={primaryButtonClass}>
                {isSavingName ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                disabled={isSavingName}
                onClick={() => {
                  setIsEditingName(false);
                  setNameDraft(contact.name ?? "");
                }}
                className={secondaryButtonClass}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1
                className={`heading-font break-words text-[2.15rem] font-bold leading-none ${
                  contact.name || contact.email || contact.phone ? "text-white" : "italic text-slate-300"
                }`}
              >
                {displayName}
              </h1>
              <button
                type="button"
                aria-label="Edit customer name"
                title="Edit name"
                onClick={() => {
                  setHeaderNotice(null);
                  setNameDraft(contact.name ?? "");
                  setIsEditingName(true);
                }}
                className="pressable inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#1a1a1a] hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M4 20h4L19 9l-4-4L4 16Z" />
                  <path d="m13.5 6.5 4 4" />
                </svg>
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-300">
            {contact.email ? <span>{contact.email}</span> : null}
            {contact.phone ? <span>{contact.phone}</span> : null}
            {identifierChips.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-slate-500">Recognised on</span>
                {identifierChips.map((channel) => (
                  <span key={channel} className={channelBadgeClass(channel)}>
                    {channel === "WEB_WIDGET" ? "Website visitor" : labelFrom(channelLabels, channel)}
                  </span>
                ))}
              </span>
            ) : null}
          </div>

          <p className="mt-3 text-sm text-slate-400">
            First seen {formatDateTime(contact.firstSeenAt, timeZone)} · Last seen{" "}
            <RelativeTime value={contact.lastSeenAt} />
            {contact.lastChannel ? ` on ${labelFrom(channelLabels, contact.lastChannel)}` : ""}
          </p>

          <NoticeMessage notice={headerNotice} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-[1.4rem] font-semibold text-white">AI memory</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-400">
                  The assistant uses this profile, plus summaries of recent conversations, when
                  this customer writes on any channel. It is rebuilt automatically when a
                  conversation ends.
                </p>
              </div>
              {!isEditingMemory ? (
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={isSavingMemory}
                    onClick={() => {
                      setMemoryNotice(null);
                      setMemoryDraft(contact.memory ?? "");
                      setIsEditingMemory(true);
                    }}
                    className={secondaryButtonClass}
                  >
                    {contact.memory ? "Edit" : "Write memory"}
                  </button>
                  {contact.memory ? (
                    <button
                      type="button"
                      disabled={isSavingMemory}
                      onClick={() => void handleClearMemory()}
                      className="pressable inline-flex h-9 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 text-sm font-medium text-red-200 transition hover:bg-red-500/15 disabled:opacity-60"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {isEditingMemory ? (
              <div className="mt-5">
                <label htmlFor="contact-memory" className="sr-only">
                  AI memory
                </label>
                <textarea
                  id="contact-memory"
                  value={memoryDraft}
                  autoFocus
                  onChange={(event) => setMemoryDraft(event.target.value)}
                  placeholder="e.g. Prefers email. Has a Pro plan. Asked about a refund for order 1042 in March."
                  aria-describedby="contact-memory-count"
                  aria-invalid={memoryTooLong}
                  className={`min-h-[180px] w-full resize-y rounded-xl border bg-[#111111] px-4 py-3 text-sm leading-7 text-white outline-none transition focus:border-white ${
                    memoryTooLong ? "border-red-500/60" : "border-white/10"
                  }`}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p
                    id="contact-memory-count"
                    className={`text-xs tabular-nums ${memoryTooLong ? "text-red-300" : "text-slate-500"}`}
                  >
                    {memoryDraft.length.toLocaleString("en-US")} / {MAX_MEMORY_LENGTH.toLocaleString("en-US")} characters
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={isSavingMemory}
                      onClick={() => {
                        setIsEditingMemory(false);
                        setMemoryDraft(contact.memory ?? "");
                        setMemoryNotice(null);
                      }}
                      className={secondaryButtonClass}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isSavingMemory || memoryTooLong}
                      onClick={() => void handleSaveMemory()}
                      className={primaryButtonClass}
                    >
                      {isSavingMemory ? "Saving..." : "Save memory"}
                    </button>
                  </div>
                </div>
              </div>
            ) : contact.memory ? (
              <div className="mt-5">
                <div className="whitespace-pre-wrap break-words rounded-xl bg-[#1f1f1f] px-5 py-4 text-sm leading-7 text-slate-100">
                  {contact.memory}
                </div>
                {contact.memoryUpdatedAt ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Updated {formatDateTime(contact.memoryUpdatedAt, timeZone)}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-[#080808] px-5 py-6 text-sm text-slate-400">
                No memory yet. It is written automatically after this customer&apos;s first
                conversation ends, or you can write one now.
              </div>
            )}

            <NoticeMessage notice={memoryNotice} />
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[1.4rem] font-semibold text-white">Conversations</h2>
              <span className="text-sm text-slate-400">
                {sessions.length === 1 ? "1 conversation" : `${sessions.length} conversations`}
              </span>
            </div>

            {sessions.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-[#080808] px-5 py-8 text-sm text-slate-400">
                No conversations yet.
              </div>
            ) : (
              <ol className="mt-5 space-y-4">
                {sessions.map((item) => (
                  <li
                    key={item.id}
                    id={`session-${item.id}`}
                    className="scroll-mt-6 rounded-2xl border border-white/10 bg-[#111111] px-5 py-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={channelBadgeClass(item.channel)}>
                            {labelFrom(channelLabels, item.channel)}
                          </span>
                          <span className={sessionStatusBadgeClass(item.status)}>
                            {labelFrom(sessionStatusLabels, item.status)}
                          </span>
                          {item.resolution ? (
                            <span className={resolutionBadgeClass(item.resolution)}>
                              {labelFrom(resolutionLabels, item.resolution)}
                            </span>
                          ) : null}
                          {item.source ? (
                            <span className="text-xs text-slate-500">via {item.source}</span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm text-slate-400">
                          Started {formatDateTime(item.startedAt, timeZone)}
                          {item.endedAt
                            ? ` · Ended ${formatDateTime(item.endedAt, timeZone)}`
                            : ` · Last activity ${formatDateTime(item.lastActivityAt, timeZone)}`}
                          {item.closedReason ? ` · ${labelFrom(closedReasonLabels, item.closedReason)}` : ""}
                          {` · ${item.messageCount} ${item.messageCount === 1 ? "message" : "messages"}`}
                        </p>
                      </div>
                      <Link
                        href={`/dashboard/chats?session=${encodeURIComponent(item.id)}`}
                        className="shrink-0 text-sm font-medium text-white underline decoration-white/30 underline-offset-4 transition hover:decoration-white"
                      >
                        Open in Chats
                      </Link>
                    </div>

                    {item.previousSessionId ? (
                      <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-violet-500/10 px-2.5 py-1 text-xs text-violet-200">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="M9 14 4 9l5-5" />
                          <path d="M4 9h10a6 6 0 0 1 0 12h-2" />
                        </svg>
                        {sessionIds.has(item.previousSessionId) ? (
                          <a href={`#session-${item.previousSessionId}`} className="underline underline-offset-2 hover:text-white">
                            Continued from a previous conversation
                          </a>
                        ) : (
                          "Continued from a previous conversation"
                        )}
                      </p>
                    ) : null}

                    {item.summary ? (
                      <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-[#1a1a1a] px-4 py-3 text-sm leading-6 text-slate-200">
                        {item.summary}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <h2 className="text-[1.4rem] font-semibold text-white">Tickets</h2>

            {tickets.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-[#080808] px-5 py-6 text-sm text-slate-400">
                No tickets for this customer.
              </div>
            ) : (
              <ul className="mt-5 space-y-3">
                {tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <Link
                      href={`/dashboard/tickets/${ticket.id}`}
                      className="block rounded-xl border border-white/10 bg-[#111111] px-4 py-3 transition hover:border-white/20 hover:bg-[#161616]"
                    >
                      <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                        <span className="font-semibold text-white">{ticket.reference}</span>
                        <span>{formatDateTime(ticket.createdAt, timeZone)}</span>
                      </div>
                      <p className="mt-1.5 break-words text-sm font-medium text-white">
                        {ticket.subject}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className={ticketStatusBadgeClass(ticket.status)}>
                          {formatTicketLabel(ticket.status)}
                        </span>
                        <span className={priorityBadgeClass(ticket.priority)}>
                          {formatTicketLabel(ticket.priority)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <h2 className="text-[1.4rem] font-semibold text-white">Activity</h2>

            {events.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-[#080808] px-5 py-6 text-sm text-slate-400">
                No activity recorded yet.
              </div>
            ) : (
              <ol className="mt-5 max-h-[560px] space-y-4 overflow-y-auto pr-1">
                {events.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${eventDotClass(event.type)}`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">
                        {labelFrom(sessionEventLabels, event.type)}
                      </p>
                      {event.detail ? (
                        <p className="mt-0.5 break-words text-sm text-slate-400">{event.detail}</p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatDateTime(event.createdAt, timeZone)}
                        {event.sessionId && sessionIds.has(event.sessionId) ? (
                          <>
                            {" · "}
                            <a
                              href={`#session-${event.sessionId}`}
                              className="underline underline-offset-2 hover:text-white"
                            >
                              View conversation
                            </a>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {canErase ? (
            <section className="rounded-2xl border border-red-500/30 bg-red-500/[0.04] p-6">
              <h2 className="text-[1.4rem] font-semibold text-red-100">Danger zone</h2>
              <p className="mt-1 text-sm text-slate-400">
                Forget this customer to honour a privacy request. Their channel links and AI
                memory are deleted, so the assistant treats them as a new visitor next time.
                Tickets are kept as business records but unlinked.
              </p>

              <label className="mt-4 flex items-start gap-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={eraseConversations}
                  disabled={isErasing}
                  onChange={(event) => setEraseConversations(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-red-500"
                />
                <span>
                  Also delete their chat conversations
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Otherwise transcripts are kept for your team with name, email, phone and
                    summary removed.
                  </span>
                </span>
              </label>

              {eraseError ? (
                <p
                  role="alert"
                  className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                >
                  {eraseError}
                </p>
              ) : null}

              <button
                type="button"
                disabled={isErasing}
                onClick={() => void handleErase()}
                className="pressable mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/15 px-4 text-sm font-semibold text-red-100 transition hover:bg-red-500/25 disabled:opacity-60"
              >
                {isErasing ? "Forgetting..." : "Forget this customer"}
              </button>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
