"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type TicketMessageItem = {
  id: string;
  sender: "USER" | "AI" | "AGENT" | "SYSTEM";
  content: string;
  createdAt: string;
};

type TicketLogItem = {
  id: string;
  action: string;
  status: string;
  model: string | null;
  tokens: number;
  durationMs: number;
  summary: string | null;
  createdAt: string;
};

type TicketDetail = {
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
  updatedAt: string;
  inbox: {
    id: string;
    name: string;
    emailPrefix: string;
  } | null;
  assignee: {
    id: string;
    fullName: string;
    email: string;
  } | null;
  tags: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  messages: TicketMessageItem[];
  logs: TicketLogItem[];
};

type TicketDetailWorkspaceProps = {
  currentUser: {
    id: string;
    fullName: string;
    email: string;
  };
  ticket: TicketDetail;
  cannedResponses: Array<{
    id: string;
    title: string;
    body: string;
  }>;
  users: Array<{
    id: string;
    fullName: string;
    email: string;
  }>;
  tags: Array<{
    id: string;
    name: string;
    color: string;
  }>;
};

type TicketApiShape = {
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
  updatedAt: string;
  inbox?: {
    id: string;
    name: string;
    emailPrefix: string;
  } | null;
  assignee?: {
    id: string;
    fullName: string;
    email: string;
  } | null;
  ticketTags?: Array<{
    tag: {
      id: string;
      name: string;
      color: string;
    };
  }>;
  messages?: TicketMessageItem[];
  logs?: TicketLogItem[];
};

type TabKey = "activity" | "logs";
type ComposerMode = "reply" | "internal";

const INTERNAL_NOTE_PREFIX = "[[INTERNAL_NOTE]]";

function mapTicketFromApi(ticket: TicketApiShape): TicketDetail {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    previewText: ticket.previewText,
    requesterName: ticket.requesterName,
    requesterEmail: ticket.requesterEmail,
    source: ticket.source,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    inbox: ticket.inbox ?? null,
    assignee: ticket.assignee ?? null,
    tags: ticket.ticketTags?.map((item) => item.tag) ?? [],
    messages: ticket.messages ?? [],
    logs: ticket.logs ?? [],
  };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatStatus(value: string) {
  if (value === "IN_PROGRESS") {
    return "Awaiting Customer Reply";
  }

  return value.toLowerCase().replaceAll("_", " ");
}

function statusBadgeClass(status: string) {
  if (status === "OPEN") {
    return "inline-flex rounded-full bg-emerald-500 px-3 py-1 text-sm font-semibold text-white";
  }

  if (status === "IN_PROGRESS") {
    return "inline-flex rounded-full bg-[#1b3d8b] px-3 py-1 text-sm font-semibold text-blue-100";
  }

  if (status === "RESOLVED") {
    return "inline-flex rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-200";
  }

  return "inline-flex rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-slate-300";
}

function priorityBadgeClass(priority: string) {
  if (priority === "URGENT") {
    return "inline-flex rounded-full bg-red-500/15 px-3 py-1 text-sm font-semibold text-red-200";
  }

  if (priority === "HIGH") {
    return "inline-flex rounded-full bg-orange-500/15 px-3 py-1 text-sm font-semibold text-orange-200";
  }

  if (priority === "LOW") {
    return "inline-flex rounded-full bg-slate-500/15 px-3 py-1 text-sm font-semibold text-slate-200";
  }

  return "inline-flex rounded-full bg-[#1f1f1f] px-3 py-1 text-sm font-semibold text-white";
}

function cleanMessageContent(content: string) {
  if (content.startsWith(INTERNAL_NOTE_PREFIX)) {
    return content.replace(`${INTERNAL_NOTE_PREFIX}\n`, "").trim();
  }

  return content;
}

function isInternalNote(content: string) {
  return content.startsWith(INTERNAL_NOTE_PREFIX);
}

function timelineLabel(
  message: TicketMessageItem,
  ticket: TicketDetail,
  currentUserName: string,
) {
  if (message.sender === "USER") {
    return ticket.requesterName || "Requester";
  }

  if (message.sender === "AI") {
    return "AI Assistant";
  }

  if (message.sender === "AGENT") {
    return ticket.assignee?.fullName || currentUserName || "Support Agent";
  }

  return isInternalNote(message.content) ? "Internal Note" : "System";
}

function timelineAction(message: TicketMessageItem) {
  if (message.sender === "USER") {
    return "created this ticket";
  }

  if (message.sender === "AI") {
    return "suggested an automated response";
  }

  if (message.sender === "AGENT") {
    return "replied";
  }

  return isInternalNote(message.content) ? "added an internal note" : "updated the ticket";
}

function applyResponseVariables(template: string, ticket: TicketDetail) {
  return template
    .replaceAll("{{requester.name}}", ticket.requesterName || "Customer")
    .replaceAll("{{requester.email}}", ticket.requesterEmail || "")
    .replaceAll("{{ticket_id}}", `#${ticket.ticketNumber}`)
    .replaceAll("{{ticket.id}}", `#${ticket.ticketNumber}`)
    .replaceAll("{{subject}}", ticket.subject)
    .replaceAll("{{status}}", formatStatus(ticket.status))
    .replaceAll("{{priority}}", formatStatus(ticket.priority))
    .replaceAll("{{created_date}}", formatDateTime(ticket.createdAt));
}

function senderIcon(message: TicketMessageItem) {
  if (message.sender === "USER") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
    );
  }

  if (message.sender === "AI") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="5" y="7" width="14" height="10" rx="2" />
        <path d="M9 7V5h6v2" />
        <path d="M8 12h.01M16 12h.01" />
        <path d="M10 14h4" />
      </svg>
    );
  }

  if (message.sender === "AGENT") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6h16v12H4z" />
        <path d="m5 7 7 6 7-6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 8v4l3 3" />
      <path d="M21 12a9 9 0 1 1-9-9" />
    </svg>
  );
}

export function TicketDetailWorkspace({
  currentUser,
  ticket: initialTicket,
  cannedResponses,
  users,
  tags,
}: TicketDetailWorkspaceProps) {
  const router = useRouter();
  const [ticket, setTicket] = useState(initialTicket);
  const [activeTab, setActiveTab] = useState<TabKey>("activity");
  const [composerMode, setComposerMode] = useState<ComposerMode>("reply");
  const [composerValue, setComposerValue] = useState("");
  const [showCannedResponses, setShowCannedResponses] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const participants = useMemo(() => {
    const people = [
      ticket.requesterName
        ? {
            key: "requester",
            name: ticket.requesterName,
            email: ticket.requesterEmail,
          }
        : null,
      ticket.assignee
        ? {
            key: ticket.assignee.id,
            name: ticket.assignee.fullName,
            email: ticket.assignee.email,
          }
        : null,
    ].filter(Boolean) as Array<{ key: string; name: string; email: string | null }>;

    return people;
  }, [ticket.assignee, ticket.requesterEmail, ticket.requesterName]);

  async function refreshTicket() {
    const response = await fetch(`/api/tickets/${ticket.id}`);
    const data = (await response.json()) as {
      error?: string;
      ticket?: TicketApiShape;
    };

    if (!response.ok || !data.ticket) {
      throw new Error(data.error ?? "Unable to refresh this ticket.");
    }

    setTicket(mapTicketFromApi(data.ticket));
  }

  async function updateTicket(payload: Record<string, unknown>) {
    setError("");
    setSuccess("");

    const response = await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as {
      error?: string;
      ticket?: TicketApiShape;
    };

    if (!response.ok || !data.ticket) {
      setError(data.error ?? "Unable to update the ticket.");
      return;
    }

    setTicket(mapTicketFromApi(data.ticket));
    setSuccess("Ticket updated successfully.");
  }

  async function handleSendMessage(closeAfterReply = false) {
    setError("");
    setSuccess("");

    if (!composerValue.trim()) {
      setError(
        composerMode === "reply"
          ? "Write a reply before sending."
          : "Write an internal note before saving it.",
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/tickets/${ticket.id}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: composerValue,
          mode: composerMode,
          closeAfterReply,
        }),
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to send the ticket response.");
        setIsSubmitting(false);
        return;
      }

      setComposerValue("");
      await refreshTicket();
      setSuccess(
        closeAfterReply
          ? "Ticket response sent and ticket closed."
          : composerMode === "reply"
            ? "Reply sent successfully."
            : "Internal note added successfully.",
      );
    } catch {
      setError("Something went wrong while sending the ticket response.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGenerateDraft() {
    setError("");
    setSuccess("");
    setIsGeneratingDraft(true);

    try {
      const response = await fetch(`/api/tickets/${ticket.id}/draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: composerValue,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        draft?: string;
      };

      if (!response.ok || !data.draft) {
        setError(data.error ?? "Unable to generate an AI draft right now.");
        setIsGeneratingDraft(false);
        return;
      }

      setComposerMode("reply");
      setComposerValue(data.draft);
      setSuccess("AI draft added to the reply box.");
      await refreshTicket();
    } catch {
      setError("Something went wrong while generating the AI draft.");
    } finally {
      setIsGeneratingDraft(false);
    }
  }

  async function handleDeleteTicket() {
    const shouldDelete = window.confirm(
      `Delete ticket #${ticket.ticketNumber}? This action cannot be undone.`,
    );

    if (!shouldDelete) {
      return;
    }

    const response = await fetch(`/api/tickets/${ticket.id}`, {
      method: "DELETE",
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to delete this ticket.");
      return;
    }

    router.push("/dashboard/tickets");
  }

  function toggleTag(tagId: string) {
    const nextTagIds = ticket.tags.some((item) => item.id === tagId)
      ? ticket.tags.filter((item) => item.id !== tagId).map((item) => item.id)
      : [...ticket.tags.map((item) => item.id), tagId];

    void updateTicket({ tagIds: nextTagIds });
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="heading-font text-[2.15rem] font-bold leading-none text-white">
              {ticket.subject}
            </h1>
            <span className="rounded-lg bg-[#151515] px-3 py-1 text-sm font-semibold text-slate-300">
              #{ticket.ticketNumber}
            </span>
            <span className={statusBadgeClass(ticket.status)}>
              {formatStatus(ticket.status)}
            </span>
          </div>
          <p className="mt-3 text-base text-slate-400">
            Created on {formatDateTime(ticket.createdAt)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(`#${ticket.ticketNumber}`)}
            className="pressable inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#111111] text-slate-200 transition hover:bg-[#1a1a1a]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="9" y="9" width="10" height="10" rx="2" />
              <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard/tickets")}
            className="pressable inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#111111] text-slate-200 transition hover:bg-[#1a1a1a]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m6 6 12 12" />
              <path d="m18 6-12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_450px]">
        <div className="space-y-6">
          <div className="inline-flex rounded-xl border border-white/10 bg-[#111111] p-1">
            {([
              { key: "activity", label: "Activity" },
              { key: "logs", label: "Logs" },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  activeTab === tab.key
                    ? "bg-white text-[#050505]"
                    : "text-slate-300 hover:bg-white/5"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "activity" ? (
            <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
              <h2 className="text-[1.65rem] font-semibold text-white">Timeline</h2>

              <div className="mt-6 space-y-6">
                {ticket.messages.map((message) => {
                  const internal = isInternalNote(message.content);

                  return (
                    <div key={message.id} className="flex gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1f1f1f] text-slate-300">
                        {senderIcon(message)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                          <p className="text-[1.05rem] text-slate-300">
                            <span className="font-semibold text-white">
                              {timelineLabel(message, ticket, currentUser.fullName)}
                            </span>{" "}
                            {timelineAction(message)}
                          </p>
                          <p className="text-sm text-slate-400">
                            {formatDateTime(message.createdAt)}
                          </p>
                        </div>

                        <div
                          className={`mt-3 rounded-xl px-5 py-4 text-[1.05rem] leading-8 ${
                            internal
                              ? "border border-amber-500/20 bg-amber-500/10 text-amber-100"
                              : "bg-[#1f1f1f] text-slate-100"
                          }`}
                        >
                          {cleanMessageContent(message.content)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
              <h2 className="text-[1.65rem] font-semibold text-white">Logs</h2>

              <div className="mt-6 space-y-4">
                {ticket.logs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-[#080808] px-5 py-8 text-sm text-slate-400">
                    No ticket logs are available yet.
                  </div>
                ) : (
                  ticket.logs.map((log) => (
                    <article
                      key={log.id}
                      className="rounded-2xl border border-white/10 bg-[#111111] px-5 py-4"
                    >
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-base font-semibold text-white">
                            {log.action.replaceAll("_", " ")}
                          </p>
                          <p className="mt-1 text-sm text-slate-400">
                            {log.summary || "No additional summary was recorded."}
                          </p>
                        </div>
                        <p className="text-sm text-slate-400">
                          {formatDateTime(log.createdAt)}
                        </p>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
                        <span className="rounded-full bg-white/5 px-3 py-1">
                          {log.status}
                        </span>
                        <span className="rounded-full bg-white/5 px-3 py-1">
                          {log.model || "System"}
                        </span>
                        <span className="rounded-full bg-white/5 px-3 py-1">
                          {log.tokens} tokens
                        </span>
                        <span className="rounded-full bg-white/5 px-3 py-1">
                          {(log.durationMs / 1000).toFixed(2)}s
                        </span>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="inline-flex rounded-xl border border-white/10 bg-[#111111] p-1">
                {([
                  { key: "reply", label: "Reply" },
                  { key: "internal", label: "Internal Note" },
                ] as const).map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    onClick={() => setComposerMode(mode.key)}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                      composerMode === mode.key
                        ? "bg-white text-[#050505]"
                        : "text-slate-300 hover:bg-white/5"
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setShowCannedResponses((current) => !current)
                    }
                    className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a1a1a]"
                  >
                    Canned Responses
                  </button>
                  {showCannedResponses ? (
                    <div className="absolute right-0 top-12 z-20 min-w-[260px] rounded-xl border border-white/10 bg-[#111111] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
                      {cannedResponses.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-slate-400">
                          No canned responses available.
                        </div>
                      ) : (
                        cannedResponses.map((response) => (
                          <button
                            key={response.id}
                            type="button"
                            onClick={() => {
                              setComposerValue((current) =>
                                current
                                  ? `${current}\n\n${applyResponseVariables(
                                      response.body,
                                      ticket,
                                    )}`
                                  : applyResponseVariables(response.body, ticket),
                              );
                              setShowCannedResponses(false);
                            }}
                            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5"
                          >
                            {response.title}
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  disabled={isGeneratingDraft}
                  onClick={() => void handleGenerateDraft()}
                  className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-60"
                >
                  {isGeneratingDraft ? "Generating..." : "AI Assistant"}
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-[#0b0b0b]">
              <div className="flex items-center gap-4 border-b border-white/10 px-4 py-3 text-slate-300">
                {["B", "I", "List", "Link"].map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="text-sm font-medium transition hover:text-white"
                  >
                    {item}
                  </button>
                ))}
                <button
                  type="button"
                  className="ml-auto rounded-lg bg-[#1f1f1f] px-3 py-1.5 text-sm font-semibold text-white"
                >
                  Variables
                </button>
              </div>
              <textarea
                value={composerValue}
                onChange={(event) => setComposerValue(event.target.value)}
                placeholder={
                  composerMode === "reply"
                    ? "Write your response to the requester..."
                    : "Add an internal note for your team..."
                }
                className="min-h-[220px] w-full resize-none bg-transparent px-4 py-4 text-base leading-8 text-white outline-none"
              />
            </div>

            {error ? (
              <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            ) : null}

            {success ? (
              <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {success}
              </p>
            ) : null}

            <div className="mt-4 flex flex-col gap-4 border-t border-white/10 pt-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void handleSendMessage(false)}
                  className="pressable inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
                >
                  {composerMode === "reply"
                    ? isSubmitting
                      ? "Sending..."
                      : "Send Reply"
                    : isSubmitting
                      ? "Saving..."
                      : "Add Note"}
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() =>
                    composerMode === "reply"
                      ? void handleSendMessage(true)
                      : void updateTicket({ status: "CLOSED" })
                  }
                  className="pressable inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#111111] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-60"
                >
                  Close Ticket
                </button>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void updateTicket({ assignToMe: true })}
                  className="pressable inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
                >
                  Assign to me
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteTicket()}
                  className="pressable inline-flex items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200 transition hover:bg-red-500/15"
                >
                  Delete Ticket
                </button>
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-[1.55rem] font-semibold text-white">Requester</h2>
              <button
                type="button"
                className="text-slate-400 transition hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            </div>
            <div className="mt-5 space-y-4 text-base text-slate-200">
              <div className="flex items-center gap-3">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                  <path d="M5 20a7 7 0 0 1 14 0" />
                </svg>
                <span>{ticket.requesterName || "Unknown requester"}</span>
              </div>
              <div className="flex items-center gap-3">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 6h16v12H4z" />
                  <path d="m5 7 7 6 7-6" />
                </svg>
                <span>{ticket.requesterEmail || "No requester email"}</span>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-[1.55rem] font-semibold text-white">Properties</h2>
              <span className="text-slate-400">...</span>
            </div>

            <div className="mt-6 space-y-6">
              <div>
                <p className="text-lg font-semibold text-white">Priority</p>
                <div className="mt-3 flex items-center gap-3">
                  <span className={priorityBadgeClass(ticket.priority)}>
                    {formatStatus(ticket.priority)}
                  </span>
                  <select
                    value={ticket.priority}
                    onChange={(event) =>
                      void updateTicket({ priority: event.target.value })
                    }
                    className="rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-sm text-white outline-none"
                  >
                    {["LOW", "MEDIUM", "HIGH", "URGENT"].map((priority) => (
                      <option key={priority} value={priority}>
                        {formatStatus(priority)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <p className="text-lg font-semibold text-white">Tags</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {tags.map((tag) => {
                    const selected = ticket.tags.some((item) => item.id === tag.id);

                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                          selected
                            ? "border-white bg-white text-[#050505]"
                            : "border-white/10 bg-[#111111] text-slate-300 hover:bg-[#191919]"
                        }`}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-lg font-semibold text-white">Status</p>
                <div className="mt-3 flex items-center gap-3">
                  <span className={statusBadgeClass(ticket.status)}>
                    {formatStatus(ticket.status)}
                  </span>
                  <select
                    value={ticket.status}
                    onChange={(event) =>
                      void updateTicket({ status: event.target.value })
                    }
                    className="rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-sm text-white outline-none"
                  >
                    {["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"].map((status) => (
                      <option key={status} value={status}>
                        {formatStatus(status)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-[1.5rem] font-semibold text-white">Inbox</h2>
                  <button type="button" className="text-slate-400 transition hover:text-white">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                </div>

                <div className="mt-4 space-y-4 text-base text-slate-200">
                  <div className="flex items-center gap-3">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M5 6h14v12H5z" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                    <span>{ticket.inbox?.name || "No inbox assigned"}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M4 6h16v12H4z" />
                      <path d="m5 7 7 6 7-6" />
                    </svg>
                    <span>
                      {ticket.inbox
                        ? `${ticket.inbox.emailPrefix}@assistdesk.ai`
                        : "No inbox email"}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-[1.35rem] font-semibold text-white">Assignee</h3>
                  <button type="button" className="text-slate-400 transition hover:text-white">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  <select
                    value={ticket.assignee?.id || ""}
                    onChange={(event) =>
                      void updateTicket({
                        assigneeId: event.target.value || null,
                      })
                    }
                    className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none"
                  >
                    <option value="">Unassigned</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.fullName}
                      </option>
                    ))}
                  </select>

                  {ticket.assignee ? (
                    <div className="space-y-3 text-base text-slate-200">
                      <div className="flex items-center gap-3">
                        <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                          <path d="M5 20a7 7 0 0 1 14 0" />
                        </svg>
                        <span>{ticket.assignee.fullName}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M4 6h16v12H4z" />
                          <path d="m5 7 7 6 7-6" />
                        </svg>
                        <span>{ticket.assignee.email}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-[1.35rem] font-semibold text-white">Participants</h3>
                  <button type="button" className="text-slate-400 transition hover:text-white">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  {participants.map((participant) => (
                    <div
                      key={participant.key}
                      className="rounded-xl border border-white/10 bg-[#111111] px-4 py-3"
                    >
                      <p className="text-sm font-semibold text-white">{participant.name}</p>
                      <p className="mt-1 text-sm text-slate-400">
                        {participant.email || "No email available"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
