"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyCannedVariables,
  applyMarkdownFormat,
  cannedVariables,
  formatTicketLabel,
  type CannedVariableValues,
  type MarkdownFormat,
} from "@/src/lib/canned-variables";

type TicketMessageItem = {
  id: string;
  sender: "USER" | "AI" | "AGENT" | "SYSTEM";
  content: string;
  authorName: string | null;
  deliveryStatus: string | null;
  deliveryError: string | null;
  createdAt: string;
};

type DeliveryNotice = {
  tone: "success" | "warning" | "error";
  text: string;
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
  timeZone: string;
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
  messages?: Array<Omit<TicketMessageItem, "authorName"> & { authorName?: string | null }>;
  logs?: TicketLogItem[];
};

type PromptTemplateOption = {
  id: string;
  name: string;
};

type TabKey = "activity" | "logs";
type ComposerMode = "reply" | "internal";
type SidebarField = "priority" | "status" | "assignee" | "tags";

const INTERNAL_NOTE_PREFIX = "[[INTERNAL_NOTE]]";
const priorityValues = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const statusValues = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

const formatButtons: Array<{ format: MarkdownFormat; label: string; ariaLabel: string; className: string }> = [
  { format: "bold", label: "B", ariaLabel: "Bold", className: "font-bold" },
  { format: "italic", label: "I", ariaLabel: "Italic", className: "italic" },
  { format: "bullet", label: "List", ariaLabel: "Bulleted list", className: "" },
  { format: "link", label: "Link", ariaLabel: "Insert link", className: "" },
];

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
    messages:
      ticket.messages?.map((message) => ({
        ...message,
        authorName: message.authorName ?? null,
      })) ?? [],
    logs: ticket.logs ?? [],
  };
}

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

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(new Date(value));
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

function timelineLabel(message: TicketMessageItem, ticket: TicketDetail) {
  if (message.sender === "USER") {
    return message.authorName || ticket.requesterName || "Requester";
  }

  if (message.sender === "AI") {
    return message.authorName || "AI";
  }

  if (message.sender === "AGENT") {
    return message.authorName || "Agent";
  }

  if (isInternalNote(message.content)) {
    return message.authorName || "Agent";
  }

  return "System";
}

function timelineAction(message: TicketMessageItem, isFirstUserMessage: boolean) {
  if (message.sender === "USER") {
    return isFirstUserMessage ? "created this ticket" : "replied";
  }

  if (message.sender === "AI") {
    return "suggested an automated response";
  }

  if (message.sender === "AGENT") {
    return "replied";
  }

  return isInternalNote(message.content) ? "added an internal note" : "updated the ticket";
}

function variableValues(
  ticket: TicketDetail,
  agentName: string,
  timeZone: string,
): CannedVariableValues {
  return {
    customer_name: ticket.requesterName || "Customer",
    customer_email: ticket.requesterEmail || "",
    ticket_number: `#${ticket.ticketNumber}`,
    subject: ticket.subject,
    status: formatTicketLabel(ticket.status),
    priority: formatTicketLabel(ticket.priority),
    agent_name: agentName,
    created_date: formatDate(ticket.createdAt, timeZone),
  };
}

function replyDeliveryNotice(
  deliveryStatus: string | null | undefined,
  deliveryError: string | null | undefined,
  requesterEmail: string | null,
  closeAfterReply: boolean,
): DeliveryNotice {
  const closedSuffix = closeAfterReply ? " The ticket was closed." : "";

  if (deliveryStatus === "SENT") {
    return {
      tone: "success",
      text: `Reply emailed to ${requesterEmail || "the requester"}.${closedSuffix}`,
    };
  }

  if (deliveryStatus === "NOT_CONFIGURED") {
    return {
      tone: "warning",
      text: `Reply saved but not emailed: no email sender is configured. Set one up in Inboxes → Email sender.${closedSuffix}`,
    };
  }

  if (deliveryStatus === "FAILED") {
    return {
      tone: "error",
      text: `Reply saved but the email could not be sent: ${
        deliveryError || "unknown error"
      }${closedSuffix}`,
    };
  }

  if (deliveryStatus === "NO_RECIPIENT") {
    return {
      tone: "warning",
      text: `Saved. This ticket has no requester email.${closedSuffix}`,
    };
  }

  return {
    tone: "success",
    text: closeAfterReply
      ? "Ticket response sent and ticket closed."
      : "Reply sent successfully.",
  };
}

function deliveryNoticeClass(tone: DeliveryNotice["tone"]) {
  if (tone === "error") {
    return "mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200";
  }

  if (tone === "warning") {
    return "mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200";
  }

  return "mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200";
}

function senderIcon(message: TicketMessageItem) {
  if (message.sender === "USER") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
    );
  }

  if (message.sender === "AI") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="5" y="7" width="14" height="10" rx="2" />
        <path d="M9 7V5h6v2" />
        <path d="M8 12h.01M16 12h.01" />
        <path d="M10 14h4" />
      </svg>
    );
  }

  if (message.sender === "AGENT") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 6h16v12H4z" />
        <path d="m5 7 7 6 7-6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 8v4l3 3" />
      <path d="M21 12a9 9 0 1 1-9-9" />
    </svg>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="mt-2 text-sm text-red-300">
      {message}
    </p>
  ) : null;
}

export function TicketDetailWorkspace({
  currentUser,
  ticket: initialTicket,
  cannedResponses,
  users,
  tags,
  timeZone,
}: TicketDetailWorkspaceProps) {
  const router = useRouter();
  const [ticket, setTicket] = useState(initialTicket);
  const [activeTab, setActiveTab] = useState<TabKey>("activity");
  const [composerMode, setComposerMode] = useState<ComposerMode>("reply");
  const [composerValue, setComposerValue] = useState("");
  const [showCannedResponses, setShowCannedResponses] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplateOption[]>([]);
  const [promptTemplateId, setPromptTemplateId] = useState("");
  const [pendingField, setPendingField] = useState<SidebarField | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SidebarField, string>>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deliveryNotice, setDeliveryNotice] = useState<DeliveryNotice | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Guards against a second PATCH starting before the first one's pending state has
  // rendered; sidebar updates run one at a time (BUG-16).
  const updatingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Prompt templates are optional: if the endpoint fails or has none, the picker
    // simply stays hidden.
    fetch("/api/prompts")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { prompts?: Array<{ id?: unknown; name?: unknown }> } | null) => {
        if (cancelled || !Array.isArray(data?.prompts)) {
          return;
        }

        setPromptTemplates(
          data.prompts.flatMap((prompt) =>
            typeof prompt.id === "string" && typeof prompt.name === "string"
              ? [{ id: prompt.id, name: prompt.name }]
              : [],
          ),
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

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

  const firstUserMessageId = ticket.messages.find((message) => message.sender === "USER")?.id;
  const values = variableValues(ticket, currentUser.fullName, timeZone);
  const isUpdating = pendingField !== null;

  function clearNotices() {
    setError("");
    setSuccess("");
    setDeliveryNotice(null);
  }

  async function refreshTicket() {
    const response = await fetch(`/api/tickets/${ticket.id}`);
    const data = await readJson<{
      error?: string;
      ticket?: TicketApiShape;
    }>(response);

    if (!response.ok || !data.ticket) {
      throw new Error(data.error ?? "Unable to refresh this ticket.");
    }

    const nextTicket = mapTicketFromApi(data.ticket);
    setTicket(() => nextTicket);
  }

  /** Returns an error message when the update failed, otherwise null. */
  async function updateTicket(
    field: SidebarField,
    payload: Record<string, unknown>,
    successMessage?: string,
  ) {
    if (updatingRef.current) {
      return "Another change is still saving. Try again in a moment.";
    }

    updatingRef.current = true;
    clearNotices();
    setPendingField(field);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));

    try {
      const response = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await readJson<{
        error?: string;
        ticket?: TicketApiShape;
      }>(response);

      if (!response.ok || !data.ticket) {
        throw new Error(data.error ?? "Unable to update the ticket.");
      }

      const nextTicket = mapTicketFromApi(data.ticket);
      setTicket(() => nextTicket);

      if (successMessage) {
        setSuccess(successMessage);
      }

      return null;
    } catch (updateError) {
      const message =
        updateError instanceof Error && updateError.message
          ? updateError.message
          : "Unable to update the ticket.";
      setFieldErrors((current) => ({ ...current, [field]: message }));
      return message;
    } finally {
      updatingRef.current = false;
      setPendingField(null);
    }
  }

  function toggleTag(tagId: string) {
    const selected = ticket.tags.some((item) => item.id === tagId);
    const nextTagIds = selected
      ? ticket.tags.filter((item) => item.id !== tagId).map((item) => item.id)
      : [...ticket.tags.map((item) => item.id), tagId];

    void updateTicket("tags", { tagIds: nextTagIds });
  }

  async function handleComposerUpdate(
    field: SidebarField,
    payload: Record<string, unknown>,
    successMessage: string,
  ) {
    const failure = await updateTicket(field, payload, successMessage);

    if (failure) {
      setError(failure);
    }
  }

  function restoreSelection(start: number, end: number) {
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(start, end);
    });
  }

  function formatComposer(format: MarkdownFormat) {
    const textarea = composerRef.current;
    const start = textarea?.selectionStart ?? composerValue.length;
    const end = textarea?.selectionEnd ?? composerValue.length;
    const result = applyMarkdownFormat(composerValue, start, end, format);

    setComposerValue(result.value);
    restoreSelection(result.selectionStart, result.selectionEnd);
  }

  function insertIntoComposer(text: string) {
    const textarea = composerRef.current;
    const start = textarea?.selectionStart ?? composerValue.length;
    const end = textarea?.selectionEnd ?? composerValue.length;
    const cursor = start + text.length;

    setComposerValue(`${composerValue.slice(0, start)}${text}${composerValue.slice(end)}`);
    setShowVariables(false);
    restoreSelection(cursor, cursor);
  }

  async function handleCopyTicketNumber() {
    clearNotices();

    try {
      await navigator.clipboard.writeText(`#${ticket.ticketNumber}`);
      setSuccess(`Copied #${ticket.ticketNumber} to your clipboard.`);
    } catch {
      setError("Unable to copy the ticket number right now.");
    }
  }

  async function handleSendMessage(closeAfterReply = false) {
    clearNotices();

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

      const data = await readJson<{
        error?: string;
        message?: {
          deliveryStatus?: string | null;
          deliveryError?: string | null;
        };
      }>(response);

      if (!response.ok) {
        setError(data.error ?? "Unable to send the ticket response.");
        return;
      }

      setComposerValue("");
      await refreshTicket();

      if (composerMode === "reply") {
        setDeliveryNotice(
          replyDeliveryNotice(
            data.message?.deliveryStatus,
            data.message?.deliveryError,
            ticket.requesterEmail,
            closeAfterReply,
          ),
        );
      } else {
        setSuccess("Internal note added successfully.");
      }
    } catch {
      setError("Something went wrong while sending the ticket response.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGenerateDraft() {
    clearNotices();
    setIsGeneratingDraft(true);

    try {
      const response = await fetch(`/api/tickets/${ticket.id}/draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: composerValue,
          promptTemplateId: promptTemplateId || undefined,
        }),
      });

      const data = await readJson<{
        error?: string;
        draft?: string;
      }>(response);

      if (!response.ok || !data.draft) {
        setError(data.error ?? "Unable to generate an AI draft right now.");
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

    clearNotices();
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/tickets/${ticket.id}`, {
        method: "DELETE",
      });

      const data = await readJson<{ error?: string }>(response);

      if (!response.ok) {
        setError(data.error ?? "Unable to delete this ticket.");
        setIsDeleting(false);
        return;
      }

      router.push("/dashboard/tickets");
    } catch {
      setError("Something went wrong while deleting this ticket.");
      setIsDeleting(false);
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="heading-font break-words text-[2.15rem] font-bold leading-none text-white">
              {ticket.subject}
            </h1>
            <span className="rounded-lg bg-[#151515] px-3 py-1 text-sm font-semibold text-slate-300">
              #{ticket.ticketNumber}
            </span>
            <span className={statusBadgeClass(ticket.status)}>
              {formatTicketLabel(ticket.status)}
            </span>
          </div>
          <p className="mt-3 text-base text-slate-400">
            Created on {formatDateTime(ticket.createdAt, timeZone)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Copy ticket number"
            title="Copy ticket number"
            onClick={() => void handleCopyTicketNumber()}
            className="pressable inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#111111] text-slate-200 transition hover:bg-[#1a1a1a]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="9" y="9" width="10" height="10" rx="2" />
              <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Back to tickets"
            title="Back to tickets"
            onClick={() => router.push("/dashboard/tickets")}
            className="pressable inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#111111] text-slate-200 transition hover:bg-[#1a1a1a]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="m6 6 12 12" />
              <path d="m18 6-12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_450px]">
        <div className="min-w-0 space-y-6">
          <div className="inline-flex rounded-xl border border-white/10 bg-[#111111] p-1">
            {([
              { key: "activity", label: "Activity" },
              { key: "logs", label: "Logs" },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={activeTab === tab.key}
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
                              {timelineLabel(message, ticket)}
                            </span>{" "}
                            {timelineAction(message, message.id === firstUserMessageId)}
                            {(message.sender === "AGENT" || message.sender === "AI") &&
                            message.deliveryStatus ? (
                              <span
                                title={
                                  message.deliveryStatus === "SENT"
                                    ? undefined
                                    : message.deliveryError || undefined
                                }
                                className={`ml-2 inline-flex rounded-full px-2 py-0.5 align-middle text-xs font-medium ${
                                  message.deliveryStatus === "SENT"
                                    ? "bg-emerald-500/10 text-emerald-200"
                                    : "bg-amber-500/10 text-amber-200"
                                }`}
                              >
                                {message.deliveryStatus === "SENT" ? "Emailed" : "Not emailed"}
                              </span>
                            ) : null}
                          </p>
                          <p className="text-sm text-slate-400">
                            {formatDateTime(message.createdAt, timeZone)}
                          </p>
                        </div>

                        <div
                          className={`mt-3 whitespace-pre-wrap break-words rounded-xl px-5 py-4 text-[1.05rem] leading-8 ${
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
                          {formatDateTime(log.createdAt, timeZone)}
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
                    aria-pressed={composerMode === mode.key}
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
                    aria-haspopup="true"
                    aria-expanded={showCannedResponses}
                    onClick={() => {
                      setShowVariables(false);
                      setShowCannedResponses((current) => !current);
                    }}
                    className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a1a1a]"
                  >
                    Canned Responses
                  </button>
                  {showCannedResponses ? (
                    <div className="absolute right-0 top-12 z-20 max-h-80 min-w-[260px] overflow-y-auto rounded-xl border border-white/10 bg-[#111111] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
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
                              const text = applyCannedVariables(response.body, values);
                              setComposerValue((current) =>
                                current ? `${current}\n\n${text}` : text,
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

                {promptTemplates.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <label htmlFor="draft-prompt-template" className="text-sm text-slate-300">
                      Use prompt template
                    </label>
                    <select
                      id="draft-prompt-template"
                      value={promptTemplateId}
                      disabled={isGeneratingDraft}
                      onChange={(event) => setPromptTemplateId(event.target.value)}
                      className="rounded-lg border border-white/10 bg-[#111111] px-3 py-2.5 text-sm text-white outline-none disabled:opacity-60"
                    >
                      <option value="">Default</option>
                      {promptTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

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
                {formatButtons.map((item) => (
                  <button
                    key={item.format}
                    type="button"
                    aria-label={item.ariaLabel}
                    title={item.ariaLabel}
                    onClick={() => formatComposer(item.format)}
                    className={`text-sm font-medium transition hover:text-white ${item.className}`}
                  >
                    {item.label}
                  </button>
                ))}
                <div className="relative ml-auto">
                  <button
                    type="button"
                    aria-haspopup="true"
                    aria-expanded={showVariables}
                    onClick={() => {
                      setShowCannedResponses(false);
                      setShowVariables((current) => !current);
                    }}
                    className="rounded-lg bg-[#1f1f1f] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[#2a2a2a]"
                  >
                    Variables
                  </button>
                  {showVariables ? (
                    <div className="absolute right-0 top-10 z-20 w-[260px] rounded-xl border border-white/10 bg-[#111111] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
                      <p className="px-3 pb-2 pt-1 text-xs text-slate-500">
                        Inserts this ticket&apos;s value at the cursor.
                      </p>
                      {cannedVariables.map((variable) => (
                        <button
                          key={variable.key}
                          type="button"
                          disabled={!values[variable.key]}
                          onClick={() => insertIntoComposer(values[variable.key])}
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span>{variable.label}</span>
                          <span className="truncate text-xs text-slate-500">
                            {values[variable.key] || "Not set"}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <label htmlFor="ticket-composer" className="sr-only">
                {composerMode === "reply" ? "Reply to the requester" : "Internal note"}
              </label>
              <textarea
                id="ticket-composer"
                ref={composerRef}
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

            {deliveryNotice ? (
              <p role="status" className={deliveryNoticeClass(deliveryNotice.tone)}>
                {deliveryNotice.text}
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
                  disabled={isSubmitting || isUpdating}
                  onClick={() =>
                    composerMode === "reply"
                      ? void handleSendMessage(true)
                      : void handleComposerUpdate(
                          "status",
                          { status: "CLOSED" },
                          "Ticket closed.",
                        )
                  }
                  className="pressable inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#111111] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-60"
                >
                  {composerMode === "reply" ? "Send & Close" : "Close Ticket"}
                </button>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={isUpdating || ticket.assignee?.id === currentUser.id}
                  onClick={() =>
                    void handleComposerUpdate(
                      "assignee",
                      { assignToMe: true },
                      "Ticket assigned to you.",
                    )
                  }
                  className="pressable inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-60"
                >
                  {ticket.assignee?.id === currentUser.id ? "Assigned to you" : "Assign to me"}
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => void handleDeleteTicket()}
                  className="pressable inline-flex items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200 transition hover:bg-red-500/15 disabled:opacity-60"
                >
                  {isDeleting ? "Deleting..." : "Delete Ticket"}
                </button>
              </div>
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <h2 className="text-[1.55rem] font-semibold text-white">Requester</h2>
            <div className="mt-5 space-y-4 text-base text-slate-200">
              <div className="flex items-center gap-3">
                <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                  <path d="M5 20a7 7 0 0 1 14 0" />
                </svg>
                <span className="break-words">{ticket.requesterName || "Unknown requester"}</span>
              </div>
              <div className="flex items-center gap-3">
                <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M4 6h16v12H4z" />
                  <path d="m5 7 7 6 7-6" />
                </svg>
                <span className="break-all">{ticket.requesterEmail || "No requester email"}</span>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <h2 className="text-[1.55rem] font-semibold text-white">Properties</h2>

            <div className="mt-6 space-y-6">
              <div>
                <label htmlFor="ticket-priority" className="block text-lg font-semibold text-white">
                  Priority
                </label>
                <div className="mt-3 flex items-center gap-3">
                  <span className={priorityBadgeClass(ticket.priority)}>
                    {formatTicketLabel(ticket.priority)}
                  </span>
                  <select
                    id="ticket-priority"
                    value={ticket.priority}
                    disabled={isUpdating}
                    onChange={(event) =>
                      void updateTicket("priority", { priority: event.target.value })
                    }
                    className="rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-sm text-white outline-none disabled:opacity-60"
                  >
                    {priorityValues.map((priority) => (
                      <option key={priority} value={priority}>
                        {formatTicketLabel(priority)}
                      </option>
                    ))}
                  </select>
                  {pendingField === "priority" ? (
                    <span className="text-sm text-slate-400">Saving...</span>
                  ) : null}
                </div>
                <FieldError message={fieldErrors.priority} />
              </div>

              <div>
                <p id="ticket-tags-label" className="text-lg font-semibold text-white">
                  Tags
                  {pendingField === "tags" ? (
                    <span className="ml-3 text-sm font-normal text-slate-400">Saving...</span>
                  ) : null}
                </p>
                <div
                  role="group"
                  aria-labelledby="ticket-tags-label"
                  className="mt-3 flex flex-wrap gap-2"
                >
                  {tags.length === 0 ? (
                    <p className="text-sm text-slate-400">No tags exist in this workspace yet.</p>
                  ) : null}
                  {tags.map((tag) => {
                    const selected = ticket.tags.some((item) => item.id === tag.id);

                    return (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={selected}
                        disabled={isUpdating}
                        onClick={() => toggleTag(tag.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
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
                <FieldError message={fieldErrors.tags} />
              </div>

              <div>
                <label htmlFor="ticket-status" className="block text-lg font-semibold text-white">
                  Status
                </label>
                <div className="mt-3 flex items-center gap-3">
                  <span className={statusBadgeClass(ticket.status)}>
                    {formatTicketLabel(ticket.status)}
                  </span>
                  <select
                    id="ticket-status"
                    value={ticket.status}
                    disabled={isUpdating}
                    onChange={(event) =>
                      void updateTicket("status", { status: event.target.value })
                    }
                    className="rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-sm text-white outline-none disabled:opacity-60"
                  >
                    {statusValues.map((status) => (
                      <option key={status} value={status}>
                        {formatTicketLabel(status)}
                      </option>
                    ))}
                  </select>
                  {pendingField === "status" ? (
                    <span className="text-sm text-slate-400">Saving...</span>
                  ) : null}
                </div>
                <FieldError message={fieldErrors.status} />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
            <div className="space-y-6">
              <div>
                <h2 className="text-[1.5rem] font-semibold text-white">Inbox</h2>

                <div className="mt-4 space-y-4 text-base text-slate-200">
                  <div className="flex items-center gap-3">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M5 6h14v12H5z" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                    <span>{ticket.inbox?.name || "No inbox assigned"}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M4 6h16v12H4z" />
                      <path d="m5 7 7 6 7-6" />
                    </svg>
                    <span className="break-all">
                      {ticket.inbox
                        ? `${ticket.inbox.emailPrefix}@assistdesk.ai`
                        : "No inbox email"}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="ticket-assignee" className="block text-[1.35rem] font-semibold text-white">
                  Assignee
                </label>

                <div className="mt-4 space-y-4">
                  <select
                    id="ticket-assignee"
                    value={ticket.assignee?.id || ""}
                    disabled={isUpdating}
                    onChange={(event) =>
                      void updateTicket("assignee", {
                        assigneeId: event.target.value || null,
                      })
                    }
                    className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none disabled:opacity-60"
                  >
                    <option value="">Unassigned</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.fullName}
                      </option>
                    ))}
                  </select>
                  {pendingField === "assignee" ? (
                    <p className="text-sm text-slate-400">Saving...</p>
                  ) : null}
                  <FieldError message={fieldErrors.assignee} />

                  {ticket.assignee ? (
                    <div className="space-y-3 text-base text-slate-200">
                      <div className="flex items-center gap-3">
                        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                          <path d="M5 20a7 7 0 0 1 14 0" />
                        </svg>
                        <span>{ticket.assignee.fullName}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="M4 6h16v12H4z" />
                          <path d="m5 7 7 6 7-6" />
                        </svg>
                        <span className="break-all">{ticket.assignee.email}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div>
                <h3 className="text-[1.35rem] font-semibold text-white">Participants</h3>

                <div className="mt-4 space-y-4">
                  {participants.length === 0 ? (
                    <p className="text-sm text-slate-400">No participants yet.</p>
                  ) : null}
                  {participants.map((participant) => (
                    <div
                      key={participant.key}
                      className="rounded-xl border border-white/10 bg-[#111111] px-4 py-3"
                    >
                      <p className="text-sm font-semibold text-white">{participant.name}</p>
                      <p className="mt-1 break-all text-sm text-slate-400">
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
