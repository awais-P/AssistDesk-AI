"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type {
  ChatAttachmentItem,
  ChatSessionListItem,
} from "@/src/lib/chat-session-list";
import {
  leadSourceLabels,
  leadStatusLabels,
  leadTemperature,
  type LeadStatusValue,
} from "@/src/lib/lead-form";

// Re-exported so existing importers of these types keep working.
export type { ChatAttachmentItem, ChatSessionListItem };

type ChatMessageItem = ChatSessionListItem["messages"][number];
type ChatSender = ChatMessageItem["sender"];
type ChatStatus = ChatSessionListItem["status"];

export type ChatStatusFilter = "OPEN" | "ESCALATED" | "CLOSED" | "ALL";
type ChannelFilter = "" | "WEB_WIDGET" | "WHATSAPP" | "SLACK" | "EMAIL";

type ListFilters = {
  status: ChatStatusFilter;
  channel: ChannelFilter;
  query: string;
};

type ChatsWorkspaceProps = {
  initialSessions: ChatSessionListItem[];
  crossChannelMemory: boolean;
  initialStatusFilter?: ChatStatusFilter;
  initialSelectedId?: string | null;
};

type ReplyResponse = {
  error?: string;
  status?: ChatStatus;
  message?: {
    id: string;
    sender: ChatSender;
    content: string;
    authorName: string | null;
    attachments?: ChatAttachmentItem[];
    createdAt: string;
  };
  delivery?: {
    status: "SENT" | "FAILED" | "NOT_APPLICABLE";
    error: string | null;
  };
};

type SessionContext = {
  session: {
    id: string;
    channel: string;
    status: ChatStatus;
    startedAt: string;
    lastActivityAt: string;
    endedAt: string | null;
    expiresAt: string | null;
    idleTimeoutMinutes: number;
    closedReason: string | null;
    resolution: string | null;
    summary: string | null;
    messageCount: number;
    aiMessageCount: number;
    previousSessionId: string | null;
    rateLimitPerMinute: number | null;
    source: string | null;
  };
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    identifiers: {
      email: boolean;
      phone: boolean;
      whatsapp: boolean;
      slack: boolean;
      webVisitor: boolean;
    };
    memory: string | null;
    memoryUpdatedAt: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    channels: string[];
  } | null;
  crossChannelMemory: boolean;
  aiContext: string | null;
  otherSessions: {
    id: string;
    channel: string;
    status: ChatStatus;
    startedAt: string;
    lastActivityAt: string;
    closedReason: string | null;
    resolution: string | null;
    summary: string | null;
    messageCount: number;
  }[];
  tickets: {
    id: string;
    ticketNumber: number;
    subject: string;
    status: string;
    createdAt: string;
    source: string;
  }[];
  events: {
    id: string;
    type: string;
    detail: string | null;
    createdAt: string;
  }[];
  lead?: {
    id: string;
    status: LeadStatusValue;
    score: number;
    source: string;
    intent: string | null;
    createdAt: string;
  } | null;
  leadState?: "PROMPTED" | "CAPTURED" | "SKIPPED" | null;
};

type ContextState = {
  sessionId: string | null;
  data: SessionContext | null;
  error: string;
};

type StatusOverride = {
  status: ChatStatus;
  /** List requests started after this sequence number already reflect the change. */
  seq: number;
};

type LiveMode = "connecting" | "live" | "polling";

type Formatters = {
  date: Intl.DateTimeFormat;
  dateTime: Intl.DateTimeFormat;
};

const MAX_REPLY_LENGTH = 4000;
const SEARCH_DEBOUNCE_MS = 350;
const LIVE_REFRESH_DEBOUNCE_MS = 300;
const CONTEXT_REFRESH_DEBOUNCE_MS = 400;
const FALLBACK_POLL_INTERVAL_MS = 15 * 1000;
const EVENT_STREAM_MAX_FAILURES = 3;
const EVENT_STREAM_RECONNECT_MS = 30 * 1000;
const CLOCK_TICK_MS = 30 * 1000;
const EVENTS_PREVIEW_COUNT = 8;
const PANEL_STORAGE_KEY = "assistdesk:chats:context-panel";

const statusFilters: { value: ChatStatusFilter; label: string; title: string }[] = [
  { value: "OPEN", label: "Open", title: "Conversations handled by the AI or waiting for a human" },
  { value: "ESCALATED", label: "Human", title: "Waiting for a human" },
  { value: "CLOSED", label: "Closed", title: "Ended conversations" },
  { value: "ALL", label: "All", title: "Every conversation" },
];

const channelFilters: { value: ChannelFilter; label: string }[] = [
  { value: "", label: "All channels" },
  { value: "WEB_WIDGET", label: "Website" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "SLACK", label: "Slack" },
  { value: "EMAIL", label: "Email" },
];

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40";

const actionButtonClass = `pressable inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-60 ${focusRing}`;

const primaryButtonClass = `pressable inline-flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400 ${focusRing}`;

const dangerButtonClass = `pressable inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-60 ${focusRing}`;

function iconButtonClass({
  active = false,
  display = "inline-flex",
}: { active?: boolean; display?: string } = {}) {
  return `pressable ${display} h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 transition disabled:opacity-60 ${focusRing} ${
    active
      ? "bg-white/[0.08] text-white"
      : "bg-[#111111] text-slate-300 hover:bg-[#1a1a1a] hover:text-white"
  }`;
}

const textLinkClass = `rounded text-xs font-semibold text-slate-300 underline-offset-4 transition hover:text-white hover:underline ${focusRing}`;

const inlineLinkClass = `rounded font-semibold text-slate-200 underline underline-offset-4 transition hover:text-white ${focusRing}`;

const selectClass =
  "h-9 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white outline-none transition focus:border-white disabled:opacity-60";

function customerLabel(session: ChatSessionListItem) {
  return (
    session.contact?.name ||
    session.customerName ||
    session.contact?.email ||
    session.customerEmail ||
    session.contact?.phone ||
    session.customerPhone ||
    "Visitor"
  );
}

function channelLabel(channel: string) {
  if (channel === "SLACK") {
    return "Slack";
  }

  if (channel === "WHATSAPP") {
    return "WhatsApp";
  }

  if (channel === "EMAIL") {
    return "Email";
  }

  if (channel === "VOICE") {
    return "Voice";
  }

  return "Website";
}

function statusLabel(status: ChatStatus) {
  if (status === "ESCALATED") {
    return "Human handling";
  }

  if (status === "CLOSED") {
    return "Closed";
  }

  return "AI active";
}

function statusBadgeClass(status: ChatStatus) {
  if (status === "ESCALATED") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  }

  if (status === "CLOSED") {
    return "border-white/10 bg-[#111111] text-slate-400";
  }

  return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
}

function humanizeCode(value: string) {
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function closedReasonLabel(reason: string | null) {
  switch (reason) {
    case null:
    case "":
      return null;
    case "IDLE_TIMEOUT":
      return "Timed out (idle)";
    case "MAX_DURATION":
      return "Reached max length";
    case "CLOSED_BY_CUSTOMER":
      return "Ended by customer";
    case "CLOSED_BY_AGENT":
      return "Closed by team";
    default:
      return humanizeCode(reason);
  }
}

function resolutionLabel(resolution: string | null) {
  switch (resolution) {
    case null:
    case "":
      return null;
    case "AI_RESOLVED":
      return "Resolved by AI";
    case "HUMAN_HANDLED":
      return "Handled by team";
    case "UNANSWERED":
      return "Unanswered";
    default:
      return humanizeCode(resolution);
  }
}

function endedLabel(session: { closedReason: string | null; resolution: string | null }) {
  return ["Ended", closedReasonLabel(session.closedReason), resolutionLabel(session.resolution)]
    .filter(Boolean)
    .join(" · ");
}

const eventLabels: Record<string, string> = {
  SESSION_STARTED: "Conversation started",
  SESSION_RESUMED: "Conversation resumed",
  SESSION_EXPIRED: "Timed out",
  SESSION_CLOSED: "Conversation closed",
  CHANNEL_LINKED: "Channel linked",
  CONTACT_CREATED: "New customer",
  CONTEXT_CARRIED: "Context carried over",
  RATE_LIMITED: "Rate limited",
  HUMAN_TAKEOVER: "Human takeover",
  AI_RESUMED: "AI resumed",
  AI_LIMIT_REACHED: "AI reply limit reached",
  AI_FALLBACK_REPLY: "AI fallback reply",
};

function eventLabel(type: string) {
  return eventLabels[type] ?? humanizeCode(type);
}

function eventDotClass(type: string) {
  switch (type) {
    case "SESSION_STARTED":
    case "SESSION_RESUMED":
    case "AI_RESUMED":
      return "bg-emerald-400";
    case "HUMAN_TAKEOVER":
    case "RATE_LIMITED":
    case "AI_LIMIT_REACHED":
    case "AI_FALLBACK_REPLY":
      return "bg-amber-400";
    case "CONTEXT_CARRIED":
    case "CHANNEL_LINKED":
    case "CONTACT_CREATED":
      return "bg-sky-400";
    default:
      return "bg-slate-500";
  }
}

function ticketStatusLabel(status: string) {
  return status === "IN_PROGRESS" ? "In progress" : humanizeCode(status);
}

function ticketStatusClass(status: string) {
  if (status === "OPEN") {
    return "border-sky-500/20 bg-sky-500/10 text-sky-200";
  }

  if (status === "IN_PROGRESS") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  }

  if (status === "RESOLVED") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }

  return "border-white/10 bg-[#111111] text-slate-400";
}

function leadStatusClass(status: string) {
  if (status === "NEW") {
    return "border-sky-500/20 bg-sky-500/10 text-sky-200";
  }

  if (status === "CONTACTED" || status === "QUALIFIED") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  }

  if (status === "CONVERTED") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }

  return "border-white/10 bg-[#111111] text-slate-400";
}

function leadTemperatureClass(score: number) {
  const temperature = leadTemperature(score);

  if (temperature === "HOT") {
    return "border-red-500/20 bg-red-500/10 text-red-200";
  }

  if (temperature === "WARM") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  }

  return "border-white/10 bg-[#111111] text-slate-400";
}

function safeAttachmentUrl(url: string) {
  if (url.startsWith("/") && !url.startsWith("//")) {
    return url;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function formatFileSize(size: number | null) {
  if (!size || size <= 0) {
    return null;
  }

  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(
  value: string,
  now: number,
  formatter: Intl.DateTimeFormat,
) {
  const diffMinutes = Math.floor((now - new Date(value).getTime()) / 60000);

  if (diffMinutes < 1) {
    return "Just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);

  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return formatter.format(new Date(value));
}

function formatDuration(totalMinutes: number) {
  const minutes = Math.max(1, Math.round(totalMinutes));

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  if (hours < 24) {
    return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;

  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}

function expiryInfo(expiresAt: string | null, now: number) {
  if (!expiresAt) {
    return null;
  }

  const remainingMs = new Date(expiresAt).getTime() - now;

  if (remainingMs < 60 * 1000) {
    return { label: "Expires soon", urgent: true };
  }

  const minutes = Math.floor(remainingMs / 60000);

  return { label: `Expires in ${formatDuration(minutes)}`, urgent: minutes < 5 };
}

function messagePreview(session: ChatSessionListItem) {
  const lastMessage =
    [...session.messages].reverse().find((message) => message.sender !== "SYSTEM") ??
    session.messages[session.messages.length - 1];

  if (!lastMessage) {
    return "No messages yet";
  }

  const text =
    lastMessage.content.trim() ||
    (lastMessage.attachments.length > 0 ? "Sent an attachment" : "");
  const prefix =
    lastMessage.sender === "AI"
      ? "AI: "
      : lastMessage.sender === "AGENT"
        ? `${lastMessage.authorName || "Agent"}: `
        : "";

  return `${prefix}${text}`;
}

function listQueryString(filters: ListFilters) {
  const params = new URLSearchParams();

  if (filters.status !== "ALL") {
    params.set("status", filters.status);
  }

  if (filters.channel) {
    params.set("channel", filters.channel);
  }

  if (filters.query) {
    params.set("q", filters.query);
  }

  return params.toString();
}

function filtersKey(filters: ListFilters) {
  return `${filters.status}|${filters.channel}|${filters.query}`;
}

/** Applies optimistic status changes and just-sent replies on top of server data. */
function decorateSession(
  session: ChatSessionListItem,
  overrides: Record<string, StatusOverride>,
  sentMessages: Record<string, ChatMessageItem[]>,
): ChatSessionListItem {
  const override = overrides[session.id];
  const pending = sentMessages[session.id];
  let messages = session.messages;

  if (pending?.length) {
    const knownIds = new Set(session.messages.map((message) => message.id));
    const extra = pending.filter((message) => !knownIds.has(message.id));

    if (extra.length > 0) {
      messages = [...session.messages, ...extra];
    }
  }

  if (!override && messages === session.messages) {
    return session;
  }

  return {
    ...session,
    status: override?.status ?? session.status,
    messages,
  };
}

function ChannelIcon({ channel, className = "h-3.5 w-3.5" }: { channel: string; className?: string }) {
  if (channel === "SLACK") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M9 4v16M15 4v16M4 9h16M4 15h16" />
      </svg>
    );
  }

  if (channel === "WHATSAPP") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8Z" />
        <path d="M9.5 9.5c.5 2 2 3.5 4 4" />
      </svg>
    );
  }

  if (channel === "EMAIL") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 6h16v12H4z" />
        <path d="m5 7 7 6 7-6" />
      </svg>
    );
  }

  if (channel === "VOICE") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

function ReturnIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function ClockIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function PanelIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </svg>
  );
}

function CloseIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function RefreshIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M20 11a8 8 0 0 0-14.9-3.9L4 9" />
      <path d="M4 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14.9 3.9L20 15" />
      <path d="M20 20v-5h-5" />
    </svg>
  );
}

function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#111111] px-2.5 py-1 text-[11px] text-slate-300">
      <ChannelIcon channel={channel} />
      {channelLabel(channel)}
    </span>
  );
}

function StatusBadge({ status }: { status: ChatStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusBadgeClass(status)}`}
    >
      {statusLabel(status)}
    </span>
  );
}

function ReturningBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-200"
      title="Continues an earlier conversation with this customer"
    >
      <ReturnIcon />
      Returning
    </span>
  );
}

function MessageAttachments({
  attachments,
  inverted,
}: {
  attachments: ChatAttachmentItem[];
  inverted: boolean;
}) {
  const items = attachments.flatMap((attachment) => {
    const url = safeAttachmentUrl(attachment.url);
    return url ? [{ ...attachment, url }] : [];
  });

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((attachment, index) =>
        attachment.mimeType.startsWith("image/") ? (
          <a
            key={`${attachment.url}-${index}`}
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open image ${attachment.name}`}
            className="block overflow-hidden rounded-lg border border-white/10"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachment.url}
              alt={attachment.name}
              className="h-32 w-32 object-cover"
              loading="lazy"
            />
          </a>
        ) : (
          <a
            key={`${attachment.url}-${index}`}
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs transition ${
              inverted
                ? "border-black/10 bg-black/5 text-[#050505] hover:bg-black/10"
                : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" />
            </svg>
            <span className="truncate">{attachment.name}</span>
            {formatFileSize(attachment.size) ? (
              <span className={inverted ? "text-[#050505]/60" : "text-slate-500"}>
                {formatFileSize(attachment.size)}
              </span>
            ) : null}
          </a>
        ),
      )}
    </div>
  );
}

function PanelSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-white/10 px-5 py-5 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-right text-slate-200">{children}</dd>
    </div>
  );
}

function ContextSkeleton() {
  return (
    <div className="space-y-6 px-5 py-5" aria-hidden="true">
      {[0, 1, 2].map((block) => (
        <div key={block} className="space-y-3">
          <div className="h-3 w-24 animate-pulse rounded bg-white/5" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-white/5" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-white/5" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-white/5" />
        </div>
      ))}
    </div>
  );
}

type ContextPanelProps = {
  session: ChatSessionListItem;
  context: SessionContext | null;
  error: string;
  crossChannelMemory: boolean;
  formatters: Formatters | null;
  now: number | null;
  summaryPending: boolean;
  summaryError: string;
  onSummarise: () => void;
  onRetry: () => void;
  onRefreshContext: () => void;
  onOpenSession: (sessionId: string) => void;
};

function ContextPanel({
  session,
  context,
  error,
  crossChannelMemory,
  formatters,
  now,
  summaryPending,
  summaryError,
  onSummarise,
  onRetry,
  onRefreshContext,
  onOpenSession,
}: ContextPanelProps) {
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [leadPending, setLeadPending] = useState(false);
  const [leadError, setLeadError] = useState("");

  async function handleCreateLead() {
    setLeadPending(true);
    setLeadError("");

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setLeadError(data.error ?? "Couldn't create the lead. Please try again.");
        return;
      }

      onRefreshContext();
    } catch {
      setLeadError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLeadPending(false);
    }
  }

  if (!context) {
    if (error) {
      return (
        <div className="px-5 py-6">
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
          <button type="button" onClick={onRetry} className={`${actionButtonClass} mt-3`}>
            Try again
          </button>
        </div>
      );
    }

    return (
      <>
        <p className="sr-only" role="status">
          Loading customer context
        </p>
        <ContextSkeleton />
      </>
    );
  }

  const info = context.session;
  const contact = context.contact;
  const memoryEnabled = context.crossChannelMemory ?? crossChannelMemory;
  const isClosed = info.status === "CLOSED";
  const relative = (value: string) =>
    now !== null && formatters ? formatRelativeTime(value, now, formatters.date) : null;
  const absolute = (value: string) =>
    formatters ? formatters.dateTime.format(new Date(value)) : null;
  const expiry = !isClosed && now !== null ? expiryInfo(info.expiresAt, now) : null;
  const visibleEvents = showAllEvents
    ? context.events
    : context.events.slice(0, EVENTS_PREVIEW_COUNT);
  const identifierChannels = contact
    ? [
        {
          channel: "WEB_WIDGET",
          linked: contact.identifiers.webVisitor || contact.channels.includes("WEB_WIDGET"),
        },
        {
          channel: "WHATSAPP",
          linked: contact.identifiers.whatsapp || contact.channels.includes("WHATSAPP"),
        },
        {
          channel: "SLACK",
          linked: contact.identifiers.slack || contact.channels.includes("SLACK"),
        },
        {
          channel: "EMAIL",
          linked: contact.identifiers.email || contact.channels.includes("EMAIL"),
        },
      ]
    : [];

  return (
    <div>
      {error ? (
        <p className="mx-5 mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          {error}
        </p>
      ) : null}

      <PanelSection
        title="Customer"
        action={
          contact ? (
            <Link href={`/dashboard/contacts/${contact.id}`} className={textLinkClass}>
              View customer
            </Link>
          ) : null
        }
      >
        {contact ? (
          <>
            <p className="truncate text-base font-semibold text-white">
              {contact.name || contact.email || contact.phone || "Unnamed customer"}
            </p>
            <dl className="mt-3 space-y-2">
              <DetailRow label="Email">
                {contact.email ? (
                  <span className="break-all">{contact.email}</span>
                ) : (
                  <span className="text-slate-500">Not provided</span>
                )}
              </DetailRow>
              <DetailRow label="Phone">
                {contact.phone || <span className="text-slate-500">Not provided</span>}
              </DetailRow>
              <DetailRow label="First seen">{absolute(contact.firstSeenAt)}</DetailRow>
              <DetailRow label="Last seen">
                <span title={absolute(contact.lastSeenAt) ?? undefined}>
                  {relative(contact.lastSeenAt)}
                </span>
              </DetailRow>
            </dl>
            <p className="mt-4 text-xs text-slate-500">Known on</p>
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Customer channels">
              {identifierChannels.map((item) => (
                <li
                  key={item.channel}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                    item.linked
                      ? "border-white/15 bg-white/[0.06] text-slate-100"
                      : "border-dashed border-white/10 text-slate-600"
                  }`}
                  title={
                    item.linked
                      ? `Linked on ${channelLabel(item.channel)}`
                      : `Not seen on ${channelLabel(item.channel)}`
                  }
                >
                  <ChannelIcon channel={item.channel} className="h-3 w-3" />
                  {channelLabel(item.channel)}
                  <span className="sr-only">{item.linked ? "(linked)" : "(not linked)"}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="truncate text-base font-semibold text-white">{customerLabel(session)}</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              This visitor isn&apos;t linked to a customer profile yet. A profile is created
              as soon as they share an email, phone number or channel identity.
            </p>
          </>
        )}
      </PanelSection>

      <PanelSection
        title="Lead"
        action={
          context.lead ? (
            <Link href={`/dashboard/leads/${context.lead.id}`} className={textLinkClass}>
              Open lead
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void handleCreateLead()}
              disabled={leadPending}
              className={actionButtonClass}
            >
              {leadPending ? (
                <>
                  <Spinner />
                  Creating...
                </>
              ) : (
                "Create lead"
              )}
            </button>
          )
        }
      >
        {context.lead ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${leadStatusClass(context.lead.status)}`}
              >
                {leadStatusLabels[context.lead.status] ?? humanizeCode(context.lead.status)}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${leadTemperatureClass(context.lead.score)}`}
                title={`Lead score ${context.lead.score}/100`}
              >
                {humanizeCode(leadTemperature(context.lead.score))} · {context.lead.score}
              </span>
            </div>
            <dl className="mt-3 space-y-2">
              <DetailRow label="Source">
                {leadSourceLabels[context.lead.source] ?? humanizeCode(context.lead.source)}
              </DetailRow>
              <DetailRow label="Created">
                <span title={absolute(context.lead.createdAt) ?? undefined}>
                  {relative(context.lead.createdAt)}
                </span>
              </DetailRow>
            </dl>
            {context.lead.intent ? (
              <p className="mt-3 break-words text-xs leading-5 text-slate-400">
                <span className="text-slate-500">Intent: </span>
                {context.lead.intent}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm leading-6 text-slate-500">
            Not a lead yet. Create one to track follow-up with this customer.
          </p>
        )}
        {context.leadState === "PROMPTED" ? (
          <p className="mt-3 text-xs leading-5 text-sky-200">
            Lead form shown — waiting for the visitor.
          </p>
        ) : context.leadState === "SKIPPED" ? (
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Visitor skipped the lead form.
          </p>
        ) : null}
        {leadError ? (
          <p className="mt-3 text-xs leading-5 text-red-300" role="alert">
            {leadError}
          </p>
        ) : null}
      </PanelSection>

      <PanelSection title="Session">
        <dl className="space-y-2">
          <DetailRow label="Started">{absolute(info.startedAt)}</DetailRow>
          <DetailRow label="Last activity">
            <span title={absolute(info.lastActivityAt) ?? undefined}>
              {relative(info.lastActivityAt)}
            </span>
          </DetailRow>
          {isClosed ? (
            <>
              {info.endedAt ? <DetailRow label="Ended">{absolute(info.endedAt)}</DetailRow> : null}
              {closedReasonLabel(info.closedReason) ? (
                <DetailRow label="Reason">{closedReasonLabel(info.closedReason)}</DetailRow>
              ) : null}
              {resolutionLabel(info.resolution) ? (
                <DetailRow label="Resolution">{resolutionLabel(info.resolution)}</DetailRow>
              ) : null}
            </>
          ) : (
            <>
              <DetailRow label="Idle timeout">
                Closes after {formatDuration(info.idleTimeoutMinutes)} idle
              </DetailRow>
              {info.expiresAt ? (
                <DetailRow label="Expires">
                  <span
                    className={expiry?.urgent ? "text-amber-200" : undefined}
                    title={absolute(info.expiresAt) ?? undefined}
                  >
                    {expiry?.label ?? absolute(info.expiresAt)}
                  </span>
                </DetailRow>
              ) : null}
            </>
          )}
          <DetailRow label="Messages">
            {info.messageCount}
            <span className="text-slate-500"> · {info.aiMessageCount} AI replies</span>
          </DetailRow>
          {info.source ? <DetailRow label="Source">{info.source}</DetailRow> : null}
          {info.rateLimitPerMinute ? (
            <DetailRow label="Rate limit">{info.rateLimitPerMinute} messages / min</DetailRow>
          ) : null}
        </dl>
        {info.previousSessionId ? (
          <button
            type="button"
            onClick={() => onOpenSession(info.previousSessionId as string)}
            className={`pressable mt-4 inline-flex items-center gap-1.5 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/20 ${focusRing}`}
          >
            <ReturnIcon className="h-3.5 w-3.5" />
            Continues an earlier conversation
          </button>
        ) : null}
      </PanelSection>

      <PanelSection
        title="Summary"
        action={
          <button
            type="button"
            onClick={onSummarise}
            disabled={summaryPending}
            className={actionButtonClass}
          >
            {summaryPending ? (
              <>
                <Spinner />
                Summarising...
              </>
            ) : (
              "Summarise now"
            )}
          </button>
        }
      >
        {info.summary ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
            {info.summary}
          </p>
        ) : (
          <p className="text-sm text-slate-500">No summary yet.</p>
        )}
        {summaryError ? (
          <p className="mt-3 text-xs leading-5 text-red-300" role="alert">
            {summaryError}
          </p>
        ) : null}
      </PanelSection>

      <PanelSection title="AI memory">
        {!memoryEnabled ? (
          <p className="text-sm leading-6 text-slate-400">
            Cross-channel memory is turned off in{" "}
            <Link href="/dashboard/settings" className={inlineLinkClass}>
              Settings
            </Link>
            . The AI only sees the current conversation.
          </p>
        ) : (
          <>
            {contact ? (
              contact.memory ? (
                <>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
                    {contact.memory}
                  </p>
                  {contact.memoryUpdatedAt && relative(contact.memoryUpdatedAt) ? (
                    <p className="mt-2 text-xs text-slate-500">
                      Updated{" "}
                      {relative(contact.memoryUpdatedAt) === "Just now"
                        ? "just now"
                        : relative(contact.memoryUpdatedAt)}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm leading-6 text-slate-500">
                  No memory profile yet. It&apos;s written when a conversation with this
                  customer ends.
                </p>
              )
            ) : (
              <p className="text-sm leading-6 text-slate-500">
                Nothing is shared across channels until this visitor is linked to a customer.
              </p>
            )}

            <details className="group mt-4 rounded-lg border border-white/10 bg-[#0b0b0b]">
              <summary
                className={`flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold text-slate-200 transition hover:text-white [&::-webkit-details-marker]:hidden ${focusRing}`}
              >
                What the AI knows
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-500 transition group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </summary>
              <div className="border-t border-white/10">
                {context.aiContext ? (
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[11px] leading-5 text-slate-300">
                    {context.aiContext}
                  </pre>
                ) : (
                  <p className="px-3 py-3 text-xs text-slate-500">Nothing carried over yet.</p>
                )}
              </div>
            </details>
          </>
        )}
      </PanelSection>

      {contact ? (
        <PanelSection title="Other conversations">
          {context.otherSessions.length === 0 ? (
            <p className="text-sm text-slate-500">This is their first conversation.</p>
          ) : (
            <ul className="-mx-2 space-y-1">
              {context.otherSessions.map((item) => {
                const outcome =
                  item.status === "CLOSED"
                    ? resolutionLabel(item.resolution) ?? closedReasonLabel(item.closedReason) ?? "Closed"
                    : statusLabel(item.status);

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onOpenSession(item.id)}
                      className={`w-full rounded-lg px-2 py-2.5 text-left transition hover:bg-white/[0.04] ${focusRing}`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-slate-300">
                          <ChannelIcon channel={item.channel} />
                          <span className="truncate">
                            {channelLabel(item.channel)} · {outcome}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-500">
                          {relative(item.lastActivityAt)}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-slate-500">
                        {item.summary || `${item.messageCount} messages`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </PanelSection>
      ) : null}

      {contact ? (
        <PanelSection title="Tickets">
          {context.tickets.length === 0 ? (
            <p className="text-sm text-slate-500">No tickets for this customer.</p>
          ) : (
            <ul className="-mx-2 space-y-1">
              {context.tickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    href={`/dashboard/tickets/${ticket.id}`}
                    className={`flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-white/[0.04] ${focusRing}`}
                  >
                    <span className="shrink-0 text-xs font-semibold text-slate-400">
                      #{ticket.ticketNumber}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                      {ticket.subject}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${ticketStatusClass(ticket.status)}`}
                    >
                      {ticketStatusLabel(ticket.status)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </PanelSection>
      ) : null}

      <PanelSection title="Activity">
        {context.events.length === 0 ? (
          <p className="text-sm text-slate-500">No activity recorded yet.</p>
        ) : (
          <>
            <ol className="relative space-y-4 border-l border-white/10 pl-4">
              {visibleEvents.map((event) => (
                <li key={event.id} className="relative">
                  <span
                    className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-4 ring-black ${eventDotClass(event.type)}`}
                    aria-hidden="true"
                  />
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium text-slate-200">{eventLabel(event.type)}</p>
                    <time
                      dateTime={event.createdAt}
                      title={absolute(event.createdAt) ?? undefined}
                      className="shrink-0 text-[11px] text-slate-500"
                    >
                      {relative(event.createdAt)}
                    </time>
                  </div>
                  {event.detail ? (
                    <p className="mt-0.5 break-words text-xs leading-5 text-slate-500">
                      {event.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
            {context.events.length > EVENTS_PREVIEW_COUNT ? (
              <button
                type="button"
                onClick={() => setShowAllEvents((value) => !value)}
                aria-expanded={showAllEvents}
                className={`${textLinkClass} mt-4`}
              >
                {showAllEvents ? "Show less" : `Show all ${context.events.length} events`}
              </button>
            ) : null}
          </>
        )}
      </PanelSection>
    </div>
  );
}

export function ChatsWorkspace({
  initialSessions,
  crossChannelMemory,
  initialStatusFilter = "OPEN",
  initialSelectedId = null,
}: ChatsWorkspaceProps) {
  const threadRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const [rawSessions, setRawSessions] = useState(initialSessions);
  const [detachedSession, setDetachedSession] = useState<ChatSessionListItem | null>(null);
  const [statusFilter, setStatusFilter] = useState<ChatStatusFilter>(initialStatusFilter);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [isListLoading, setIsListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [listNotice, setListNotice] = useState("");
  const [liveMode, setLiveMode] = useState<LiveMode>("connecting");
  const [selectedId, setSelectedId] = useState(
    initialSelectedId ?? initialSessions[0]?.id ?? "",
  );
  const [showThreadOnMobile, setShowThreadOnMobile] = useState(Boolean(initialSelectedId));
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sentMessages, setSentMessages] = useState<Record<string, ChatMessageItem[]>>({});
  const [statusOverrides, setStatusOverrides] = useState<Record<string, StatusOverride>>({});
  const [replyValue, setReplyValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<ChatStatus | null>(null);
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [deliveryWarning, setDeliveryWarning] = useState<{
    sessionId: string;
    text: string;
  } | null>(null);
  const [contextState, setContextState] = useState<ContextState>({
    sessionId: null,
    data: null,
    error: "",
  });
  const [contextReloadToken, setContextReloadToken] = useState(0);
  const [isContextFetching, setIsContextFetching] = useState(false);
  const [summaryState, setSummaryState] = useState<{
    sessionId: string | null;
    pending: boolean;
    error: string;
  }>({ sessionId: null, pending: false, error: "" });
  const [clock, setClock] = useState<{ now: number; timeZone: string } | null>(null);

  const filtersRef = useRef<ListFilters>({ status: initialStatusFilter, channel: "", query: "" });
  const fetchedFiltersKeyRef = useRef(filtersKey(filtersRef.current));
  const listSeqRef = useRef(0);
  const listAbortRef = useRef<AbortController | null>(null);
  const rawSessionsRef = useRef(rawSessions);
  const detachedSessionRef = useRef(detachedSession);
  const selectedIdRef = useRef(selectedId);
  const pendingSelectRef = useRef<string | null>(null);
  const loadedContextIdRef = useRef<string | null>(null);

  useEffect(() => {
    rawSessionsRef.current = rawSessions;
    detachedSessionRef.current = detachedSession;
    selectedIdRef.current = selectedId;
  }, [rawSessions, detachedSession, selectedId]);

  // Dates are only rendered after mount, in the browser's time zone, so the
  // server and client markup always match. The same tick drives the expiry countdown.
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tick = () => setClock({ now: Date.now(), timeZone });

    tick();
    const interval = window.setInterval(tick, CLOCK_TICK_MS);

    return () => window.clearInterval(interval);
  }, []);

  // Per-viewer preference: whether the context column is collapsed on wide screens.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(PANEL_STORAGE_KEY) === "collapsed") {
        setPanelCollapsed(true);
      }
    } catch {
      // Storage can be unavailable (private mode, blocked site data).
    }
  }, []);

  function togglePanelCollapsed() {
    setPanelCollapsed((current) => {
      const next = !current;

      try {
        window.localStorage.setItem(PANEL_STORAGE_KEY, next ? "collapsed" : "open");
      } catch {
        // Ignore storage failures; the toggle still works for this visit.
      }

      return next;
    });
  }

  const loadList = useCallback(async ({ showLoading = false }: { showLoading?: boolean } = {}) => {
    const filters = filtersRef.current;
    const seq = ++listSeqRef.current;

    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;

    if (showLoading) {
      setIsListLoading(true);
    }

    try {
      const params = new URLSearchParams(listQueryString(filters));
      const keepFresh = pendingSelectRef.current ?? selectedIdRef.current;

      if (keepFresh) {
        params.set("include", keepFresh);
      }

      const search = params.toString();
      const response = await fetch(`/api/chat-sessions${search ? `?${search}` : ""}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as {
        sessions?: ChatSessionListItem[];
        included?: ChatSessionListItem | null;
        error?: string;
      };

      if (seq !== listSeqRef.current) {
        return;
      }

      if (!response.ok || !Array.isArray(data.sessions)) {
        setListError(data.error ?? "Couldn't refresh conversations.");
        return;
      }

      const next = data.sessions;
      const selected = selectedIdRef.current;
      const pending = pendingSelectRef.current;

      setRawSessions(next);
      setListError("");
      // Overrides made before this request started are now reflected by the server.
      setStatusOverrides((current) => {
        const entries = Object.entries(current).filter(([, override]) => override.seq >= seq);
        return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
      });
      setSentMessages((current) => {
        let changed = false;
        const kept: Record<string, ChatMessageItem[]> = {};

        for (const [sessionId, messages] of Object.entries(current)) {
          const serverSession = next.find((item) => item.id === sessionId);
          const knownIds = new Set(serverSession?.messages.map((message) => message.id) ?? []);
          const remaining = messages.filter((message) => !knownIds.has(message.id));

          if (remaining.length !== messages.length) {
            changed = true;
          }

          if (remaining.length > 0) {
            kept[sessionId] = remaining;
          }
        }

        return changed ? kept : current;
      });

      // Keep the open conversation on screen when it drops out of the current filter
      // (e.g. it was just closed while viewing "Open").
      if (data.included && data.included.id === (pending ?? selected)) {
        // Outside the current filter (or older than the latest 50): the server sent a fresh copy.
        setDetachedSession(data.included);
      } else if (selected && !next.some((item) => item.id === selected)) {
        const previous =
          rawSessionsRef.current.find((item) => item.id === selected) ??
          (detachedSessionRef.current?.id === selected ? detachedSessionRef.current : null);
        setDetachedSession(previous);
      } else {
        setDetachedSession(null);
      }

      if (pending) {
        pendingSelectRef.current = null;

        if (next.some((item) => item.id === pending) || data.included?.id === pending) {
          setSelectedId(pending);
          setShowThreadOnMobile(true);
        } else {
          setListNotice(
            "That conversation is older than the latest ones shown here. Open the customer profile to see their full history.",
          );
        }
      }
    } catch {
      if (controller.signal.aborted || seq !== listSeqRef.current) {
        return;
      }

      setListError("Couldn't refresh conversations. Check your connection.");
    } finally {
      if (seq === listSeqRef.current) {
        listAbortRef.current = null;
        setIsListLoading(false);
      }
    }
  }, []);

  // Debounced search: the server filters by customer and message text.
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setQuery(searchInput.trim().slice(0, 120)),
      SEARCH_DEBOUNCE_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    const filters: ListFilters = { status: statusFilter, channel: channelFilter, query };
    const key = filtersKey(filters);

    filtersRef.current = filters;

    if (key === fetchedFiltersKeyRef.current) {
      return;
    }

    fetchedFiltersKeyRef.current = key;
    void loadList({ showLoading: true });
  }, [statusFilter, channelFilter, query, loadList]);

  useEffect(() => {
    return () => listAbortRef.current?.abort();
  }, []);

  // Live updates: the SSE stream says *that* something changed; the list is then
  // re-fetched (debounced) with the current filters. Polling is only a fallback.
  useEffect(() => {
    let source: EventSource | null = null;
    let refreshTimer: number | undefined;
    let pollTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let failures = 0;
    let hasOpened = false;
    let disposed = false;

    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void loadList(), LIVE_REFRESH_DEBOUNCE_MS);
    };

    const startPolling = () => {
      setLiveMode("polling");

      if (pollTimer !== undefined) {
        return;
      }

      pollTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          void loadList();
        }
      }, FALLBACK_POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      source = new EventSource("/api/chat-sessions/events");

      source.onopen = () => {
        // Changes made while disconnected were not streamed; catch up once.
        if (hasOpened || failures > 0) {
          scheduleRefresh();
        }

        hasOpened = true;
        failures = 0;
        stopPolling();
        setLiveMode("live");
      };

      source.addEventListener("changed", () => {
        failures = 0;
        scheduleRefresh();
      });

      source.onerror = () => {
        failures += 1;

        // The server ends each stream after ~55s and the browser reconnects on its own;
        // only fall back when reconnecting keeps failing or the browser gave up.
        if (source?.readyState === EventSource.CLOSED) {
          source.close();
          source = null;
          startPolling();
          window.clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(connect, EVENT_STREAM_RECONNECT_MS);
        } else if (failures >= EVENT_STREAM_MAX_FAILURES) {
          startPolling();
        }
      };
    };

    if (typeof window.EventSource === "undefined") {
      startPolling();
    } else {
      connect();
    }

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        scheduleRefresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      source?.close();
      window.clearTimeout(refreshTimer);
      window.clearTimeout(reconnectTimer);
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadList]);

  const formatters = useMemo<Formatters | null>(() => {
    if (!clock) {
      return null;
    }

    return {
      date: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: clock.timeZone,
      }),
      dateTime: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: clock.timeZone,
      }),
    };
  }, [clock]);

  const sessions = useMemo(
    () => rawSessions.map((session) => decorateSession(session, statusOverrides, sentMessages)),
    [rawSessions, statusOverrides, sentMessages],
  );

  const selectedSession = useMemo(() => {
    if (!selectedId) {
      return sessions[0] ?? null;
    }

    const listed = sessions.find((session) => session.id === selectedId);

    if (listed) {
      return listed;
    }

    return detachedSession?.id === selectedId
      ? decorateSession(detachedSession, statusOverrides, sentMessages)
      : null;
  }, [sessions, selectedId, detachedSession, statusOverrides, sentMessages]);

  const selectedSessionId = selectedSession?.id ?? null;
  const selectedUpdatedAt = selectedSession?.updatedAt ?? null;
  const selectedStatus = selectedSession?.status ?? null;
  const selectedMessageCount = selectedSession?.messages.length ?? 0;

  useEffect(() => {
    const thread = threadRef.current;

    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  }, [selectedSessionId, selectedMessageCount]);

  // Context panel: fetched when the selection changes, and (debounced) whenever the
  // list shows that the selected session changed.
  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    const sessionId = selectedSessionId;
    const sameSession = loadedContextIdRef.current === sessionId;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsContextFetching(true);

      try {
        const response = await fetch(`/api/chat-sessions/${sessionId}/context`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => ({}))) as Partial<SessionContext> & {
          error?: string;
        };

        if (!response.ok || !data.session) {
          const message = data.error ?? "Couldn't load the customer context.";
          setContextState((current) =>
            current.sessionId === sessionId
              ? { ...current, error: message }
              : { sessionId, data: null, error: message },
          );
          return;
        }

        loadedContextIdRef.current = sessionId;
        setContextState({ sessionId, data: data as SessionContext, error: "" });
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        const message = "Couldn't load the customer context. Check your connection.";
        setContextState((current) =>
          current.sessionId === sessionId
            ? { ...current, error: message }
            : { sessionId, data: null, error: message },
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsContextFetching(false);
        }
      }
    }, sameSession ? CONTEXT_REFRESH_DEBOUNCE_MS : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      setIsContextFetching(false);
    };
  }, [selectedSessionId, selectedUpdatedAt, selectedStatus, contextReloadToken]);

  // The context drawer (narrow screens): focus its close button, close on Escape.
  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    drawerCloseRef.current?.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    const trigger = drawerTriggerRef.current;

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Return focus to the button that opened the drawer.
      trigger?.focus();
    };
  }, [drawerOpen]);

  function selectSession(sessionId: string) {
    if (sessionId !== selectedSession?.id) {
      setReplyValue("");
      setError("");
      setConfirmCloseId(null);
    }

    setSelectedId(sessionId);
    setShowThreadOnMobile(true);
  }

  /** Opens a conversation from the context panel, widening the filters if needed. */
  function openSession(sessionId: string) {
    setDrawerOpen(false);
    setListNotice("");

    if (
      sessions.some((session) => session.id === sessionId) ||
      detachedSession?.id === sessionId
    ) {
      selectSession(sessionId);
      return;
    }

    const alreadyUnfiltered = statusFilter === "ALL" && channelFilter === "" && query === "";

    pendingSelectRef.current = sessionId;
    setStatusFilter("ALL");
    setChannelFilter("");
    setSearchInput("");
    setQuery("");

    if (alreadyUnfiltered) {
      void loadList({ showLoading: true });
    }
  }

  function clearFilters() {
    setStatusFilter("ALL");
    setChannelFilter("");
    setSearchInput("");
    setQuery("");
  }

  function applyStatusOverride(sessionId: string, status: ChatStatus) {
    setStatusOverrides((current) => ({
      ...current,
      [sessionId]: { status, seq: listSeqRef.current },
    }));
  }

  async function handleSendReply() {
    if (!selectedSession || isSending || selectedSession.status === "CLOSED") {
      return;
    }

    const session = selectedSession;
    const content = replyValue.trim();

    setError("");
    setDeliveryWarning(null);

    if (!content) {
      setError("Write a reply before sending.");
      return;
    }

    if (content.length > MAX_REPLY_LENGTH) {
      setError(`Replies can be up to ${MAX_REPLY_LENGTH} characters.`);
      return;
    }

    setIsSending(true);

    try {
      const response = await fetch(`/api/chat-sessions/${session.id}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      });

      const data = (await response.json().catch(() => ({}))) as ReplyResponse;

      if (!response.ok || !data.message) {
        setError(data.error ?? "Unable to send your reply. Please try again.");

        if (response.status === 409) {
          void loadList();
        }

        return;
      }

      const message: ChatMessageItem = {
        id: data.message.id,
        sender: data.message.sender,
        content: data.message.content,
        authorName: data.message.authorName,
        attachments: data.message.attachments ?? [],
        createdAt: data.message.createdAt,
      };

      setSentMessages((current) => ({
        ...current,
        [session.id]: [...(current[session.id] ?? []), message],
      }));
      // Replying takes over from the AI.
      applyStatusOverride(session.id, data.status ?? "ESCALATED");
      setReplyValue("");

      if (data.delivery?.status === "FAILED") {
        setDeliveryWarning({
          sessionId: session.id,
          text: `Saved, but it could not be delivered to ${channelLabel(session.channel)}: ${
            data.delivery.error || "unknown error"
          }`,
        });
      }

      void loadList();
    } catch {
      setError("Something went wrong while sending your reply. Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleStatusChange(status: ChatStatus) {
    if (!selectedSession || pendingStatus) {
      return;
    }

    const session = selectedSession;

    setError("");
    setPendingStatus(status);

    try {
      const response = await fetch(`/api/chat-sessions/${session.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        success?: boolean;
        status?: ChatStatus;
      };

      if (!response.ok || !data.success) {
        setError(data.error ?? "Unable to update this conversation.");

        if (response.status === 409) {
          void loadList();
        }

        return;
      }

      setConfirmCloseId(null);
      applyStatusOverride(session.id, data.status ?? status);
      // The server adds the system notice; the refreshed list brings it in.
      void loadList();
    } catch {
      setError("Something went wrong while updating this conversation.");
    } finally {
      setPendingStatus(null);
    }
  }

  async function handleSummarise() {
    if (!selectedSession || summaryState.pending) {
      return;
    }

    const sessionId = selectedSession.id;

    setSummaryState({ sessionId, pending: true, error: "" });

    try {
      const response = await fetch(`/api/chat-sessions/${sessionId}/summary`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        summary?: string;
        memory?: string | null;
        error?: string;
      };

      if (!response.ok || !data.summary) {
        setSummaryState({
          sessionId,
          pending: false,
          error: data.error ?? "Couldn't summarise this conversation. Please try again.",
        });
        return;
      }

      const summary = data.summary;

      setSummaryState({ sessionId, pending: false, error: "" });
      setContextState((current) => {
        if (current.sessionId !== sessionId || !current.data) {
          return current;
        }

        return {
          ...current,
          data: {
            ...current.data,
            session: { ...current.data.session, summary },
            contact:
              current.data.contact && data.memory
                ? {
                    ...current.data.contact,
                    memory: data.memory,
                    memoryUpdatedAt: new Date().toISOString(),
                  }
                : current.data.contact,
          },
        };
      });
      setContextReloadToken((value) => value + 1);
    } catch {
      setSummaryState({
        sessionId,
        pending: false,
        error: "Something went wrong while summarising. Check your connection and try again.",
      });
    }
  }

  function handleReplyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleSendReply();
    }
  }

  const hasFilters = channelFilter !== "" || query !== "";
  const showPanelColumn = Boolean(selectedSession) && !panelCollapsed;
  const isClosed = selectedSession?.status === "CLOSED";
  const selectedContext =
    selectedSession && contextState.sessionId === selectedSession.id ? contextState : null;
  const summaryForSelected =
    selectedSession && summaryState.sessionId === selectedSession.id ? summaryState : null;
  const expiry =
    selectedSession && !isClosed && clock ? expiryInfo(selectedSession.expiresAt, clock.now) : null;
  const confirmingClose = Boolean(selectedSession) && confirmCloseId === selectedSession?.id;
  const relative = (value: string) =>
    clock && formatters ? formatRelativeTime(value, clock.now, formatters.date) : null;

  function emptyListMessage() {
    if (hasFilters) {
      return "No conversations match your filters.";
    }

    if (statusFilter === "OPEN") {
      return "No open conversations right now.";
    }

    if (statusFilter === "ESCALATED") {
      return "Nobody is waiting for a human.";
    }

    if (statusFilter === "CLOSED") {
      return "No closed conversations yet.";
    }

    return "No conversations yet. Embed your chatbot or connect Slack/WhatsApp in Integrations.";
  }

  return (
    <div className="h-[100dvh] overflow-hidden px-0 py-0 lg:h-[calc(100vh-32px)]">
      <div
        className={`grid h-full grid-rows-[minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)] ${
          showPanelColumn
            ? "xl:grid-cols-[340px_minmax(0,1fr)_minmax(320px,380px)]"
            : "xl:grid-cols-[360px_minmax(0,1fr)]"
        }`}
      >
        <aside
          className={`${
            showThreadOnMobile ? "hidden" : "flex"
          } min-h-0 flex-col border-r border-white/10 bg-black lg:flex`}
          aria-label="Conversations"
        >
          <div className="space-y-3 border-b border-white/10 p-4">
            <div className="inline-flex h-12 w-full items-center rounded-lg border border-white/10 bg-[#111111] px-3 transition focus-within:border-white">
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
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search customers or messages..."
                aria-label="Search conversations"
                maxLength={120}
                className="ml-3 w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500 [&::-webkit-search-cancel-button]:hidden"
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  aria-label="Clear search"
                  className={`ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 transition hover:text-white ${focusRing}`}
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div
              role="group"
              aria-label="Filter by status"
              className="grid grid-cols-4 gap-1 rounded-lg border border-white/10 bg-[#111111] p-1"
            >
              {statusFilters.map((filter) => {
                const active = statusFilter === filter.value;

                return (
                  <button
                    key={filter.value}
                    type="button"
                    aria-pressed={active}
                    title={filter.title}
                    onClick={() => setStatusFilter(filter.value)}
                    className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${focusRing} ${
                      active
                        ? "bg-white text-[#050505]"
                        : "text-slate-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3">
              <label htmlFor="chat-channel-filter" className="sr-only">
                Filter by channel
              </label>
              <select
                id="chat-channel-filter"
                value={channelFilter}
                onChange={(event) => setChannelFilter(event.target.value as ChannelFilter)}
                className={`${selectClass} min-w-0 flex-1`}
              >
                {channelFilters.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span
                className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500"
                title={
                  liveMode === "live"
                    ? "Updates arrive in real time"
                    : liveMode === "polling"
                      ? `Live updates unavailable; refreshing every ${FALLBACK_POLL_INTERVAL_MS / 1000}s`
                      : "Connecting to live updates"
                }
              >
                {isListLoading ? (
                  <Spinner className="h-3 w-3" />
                ) : (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      liveMode === "live"
                        ? "bg-emerald-400"
                        : liveMode === "polling"
                          ? "bg-amber-400"
                          : "bg-slate-500"
                    }`}
                    aria-hidden="true"
                  />
                )}
                {liveMode === "live" ? "Live" : liveMode === "polling" ? "Auto-refresh" : "Connecting"}
              </span>
            </div>

            {listError ? (
              <div
                className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
                role="alert"
              >
                <span>{listError}</span>
                <button
                  type="button"
                  onClick={() => void loadList({ showLoading: true })}
                  className={`shrink-0 rounded font-semibold underline-offset-4 hover:underline ${focusRing}`}
                >
                  Retry
                </button>
              </div>
            ) : null}

            {listNotice ? (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-[#0b0b0b] px-3 py-2 text-xs leading-5 text-slate-400">
                <span>{listNotice}</span>
                <button
                  type="button"
                  onClick={() => setListNotice("")}
                  aria-label="Dismiss notice"
                  className={`shrink-0 rounded text-slate-500 transition hover:text-white ${focusRing}`}
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
          </div>

          <div
            className={`min-h-0 flex-1 overflow-y-auto transition-opacity ${
              isListLoading ? "opacity-60" : ""
            }`}
            aria-busy={isListLoading}
          >
            {sessions.length === 0 ? (
              <div className="px-4 py-8">
                <p className="text-sm leading-6 text-slate-400">{emptyListMessage()}</p>
                {hasFilters ? (
                  <button type="button" onClick={clearFilters} className={`${actionButtonClass} mt-4`}>
                    Clear filters
                  </button>
                ) : statusFilter !== "ALL" ? (
                  <button
                    type="button"
                    onClick={() => setStatusFilter("ALL")}
                    className={`${actionButtonClass} mt-4`}
                  >
                    View all conversations
                  </button>
                ) : null}
              </div>
            ) : (
              sessions.map((session) => {
                const isSelected = selectedSession?.id === session.id;

                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => selectSession(session.id)}
                    aria-current={isSelected ? "true" : undefined}
                    className={`w-full border-b border-white/5 px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 ${
                      isSelected ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 truncate font-semibold text-white">
                        {customerLabel(session)}
                      </p>
                      <span className="shrink-0 text-xs text-slate-500">
                        {relative(session.lastActivityAt)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-400">
                      {messagePreview(session)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ChannelBadge channel={session.channel} />
                      <StatusBadge status={session.status} />
                      {session.previousSessionId ? <ReturningBadge /> : null}
                      {session.contact && session.contact.sessionCount > 1 ? (
                        <span
                          className="text-[11px] text-slate-500"
                          title="Conversations with this customer across all channels"
                        >
                          {session.contact.sessionCount} conversations
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section
          className={`${
            showThreadOnMobile ? "flex" : "hidden"
          } min-h-0 justify-center bg-black px-4 lg:flex lg:px-6`}
        >
          {selectedSession ? (
            <div className="flex h-full w-full max-w-4xl flex-col py-4 lg:py-6">
              <div className="shrink-0 border-b border-white/10 pb-4">
                <div className="mb-3 flex items-center justify-between gap-3 lg:hidden">
                  <button
                    type="button"
                    onClick={() => setShowThreadOnMobile(false)}
                    className={`inline-flex items-center gap-1.5 rounded text-sm text-slate-400 transition hover:text-white ${focusRing}`}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="m15 6-6 6 6 6" />
                    </svg>
                    Back to conversations
                  </button>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-xl font-semibold text-white">
                      {customerLabel(selectedSession)}
                    </p>
                    <p className="mt-2 truncate text-sm text-slate-400">
                      {[
                        selectedSession.contact?.email || selectedSession.customerEmail,
                        selectedSession.contact?.phone || selectedSession.customerPhone,
                        selectedSession.integrationName || selectedSession.chatbotName,
                      ]
                        .filter(Boolean)
                        .join(" • ") || "No contact details provided"}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ChannelBadge channel={selectedSession.channel} />
                      <StatusBadge status={selectedSession.status} />
                      {isClosed ? (
                        <span className="inline-flex items-center rounded-full border border-white/10 bg-[#111111] px-2.5 py-1 text-[11px] text-slate-400">
                          {endedLabel(selectedSession)}
                        </span>
                      ) : expiry ? (
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                            expiry.urgent
                              ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
                              : "border-white/10 bg-[#111111] text-slate-300"
                          }`}
                          title={`Closes after ${formatDuration(selectedSession.idleTimeoutMinutes)} without activity`}
                        >
                          <ClockIcon className="h-3 w-3" />
                          {expiry.label}
                        </span>
                      ) : null}
                      {selectedSession.previousSessionId ? <ReturningBadge /> : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {confirmingClose ? (
                      <>
                        <span className="text-xs text-slate-400" id="close-confirm-label">
                          End this conversation? It can&apos;t be reopened.
                        </span>
                        <button
                          type="button"
                          disabled={pendingStatus !== null}
                          onClick={() => void handleStatusChange("CLOSED")}
                          aria-describedby="close-confirm-label"
                          className={dangerButtonClass}
                        >
                          {pendingStatus === "CLOSED" ? (
                            <>
                              <Spinner />
                              Closing...
                            </>
                          ) : (
                            "Close conversation"
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={pendingStatus !== null}
                          onClick={() => setConfirmCloseId(null)}
                          className={actionButtonClass}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        {selectedSession.status === "ACTIVE" ? (
                          <button
                            type="button"
                            disabled={pendingStatus !== null}
                            onClick={() => void handleStatusChange("ESCALATED")}
                            className={primaryButtonClass}
                          >
                            {pendingStatus === "ESCALATED" ? "Taking over..." : "Take over"}
                          </button>
                        ) : null}
                        {selectedSession.status === "ESCALATED" ? (
                          <button
                            type="button"
                            disabled={pendingStatus !== null}
                            onClick={() => void handleStatusChange("ACTIVE")}
                            className={actionButtonClass}
                          >
                            {pendingStatus === "ACTIVE" ? "Handing back..." : "Hand back to AI"}
                          </button>
                        ) : null}
                        {!isClosed ? (
                          <button
                            type="button"
                            disabled={pendingStatus !== null}
                            onClick={() => setConfirmCloseId(selectedSession.id)}
                            className={actionButtonClass}
                          >
                            Close
                          </button>
                        ) : null}
                      </>
                    )}

                    <button
                      ref={drawerTriggerRef}
                      type="button"
                      onClick={() => setDrawerOpen(true)}
                      aria-expanded={drawerOpen}
                      aria-controls="chat-context-panel"
                      className={`${actionButtonClass} xl:hidden`}
                    >
                      <PanelIcon className="h-3.5 w-3.5" />
                      Context
                    </button>
                    <button
                      type="button"
                      onClick={togglePanelCollapsed}
                      aria-expanded={!panelCollapsed}
                      aria-controls="chat-context-panel"
                      aria-label={panelCollapsed ? "Show customer and context" : "Hide customer and context"}
                      title={panelCollapsed ? "Show customer & context" : "Hide customer & context"}
                      className={iconButtonClass({
                        display: "hidden xl:inline-flex",
                        active: !panelCollapsed,
                      })}
                    >
                      <PanelIcon />
                    </button>
                  </div>
                </div>
              </div>

              <div
                ref={threadRef}
                className="min-h-0 flex-1 space-y-4 overflow-y-auto py-6"
                aria-live="polite"
              >
                {selectedSession.previousSessionId ? (
                  <div className="flex justify-center px-4">
                    <p className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-white/10 bg-[#0b0b0b] px-4 py-1.5 text-center text-xs text-slate-400">
                      <ReturnIcon className="h-3.5 w-3.5 text-sky-300" />
                      Continues an earlier conversation — the AI carried the context over.
                      <button
                        type="button"
                        onClick={() => openSession(selectedSession.previousSessionId as string)}
                        className={inlineLinkClass}
                      >
                        View earlier
                      </button>
                    </p>
                  </div>
                ) : null}

                {selectedSession.messages.length === 0 ? (
                  <p className="text-center text-sm text-slate-500">No messages yet.</p>
                ) : null}

                {selectedSession.messages.map((message) => {
                  const time =
                    formatters ? formatters.dateTime.format(new Date(message.createdAt)) : null;

                  if (message.sender === "SYSTEM") {
                    return (
                      <p
                        key={message.id}
                        className="px-4 text-center text-xs leading-5 text-slate-500 whitespace-pre-wrap"
                      >
                        {message.content}
                        {time ? <span className="ml-2 text-slate-600">{time}</span> : null}
                      </p>
                    );
                  }

                  const fromCustomer = message.sender === "USER";
                  const fromAi = message.sender === "AI";
                  const author = fromCustomer
                    ? null
                    : message.authorName ||
                      (fromAi ? selectedSession.chatbotName || "AI assistant" : "Team member");

                  return (
                    <div
                      key={message.id}
                      className={`flex flex-col ${fromCustomer ? "items-start" : "items-end"}`}
                    >
                      {author ? (
                        <p className="mb-1 px-1 text-xs text-slate-500">
                          {author}
                          {fromAi ? " · AI" : ""}
                        </p>
                      ) : null}
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-2xl ${
                          fromCustomer
                            ? "bg-[#111111] text-white"
                            : fromAi
                              ? "bg-white text-[#050505]"
                              : "bg-[#1b3d8b] text-blue-50"
                        }`}
                      >
                        {message.content ? (
                          <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        ) : null}
                        <MessageAttachments attachments={message.attachments} inverted={fromAi} />
                        {time ? (
                          <p
                            className={`mt-2 text-xs ${
                              fromAi
                                ? "text-[#050505]/70"
                                : fromCustomer
                                  ? "text-slate-500"
                                  : "text-blue-100/70"
                            }`}
                          >
                            {time}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="shrink-0 border-t border-white/10 pt-4">
                {error ? (
                  <p
                    className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}

                {deliveryWarning?.sessionId === selectedSession.id ? (
                  <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    {deliveryWarning.text}
                  </p>
                ) : null}

                {isClosed ? (
                  <p
                    className="rounded-xl border border-white/10 bg-[#0b0b0b] px-4 py-4 text-sm leading-6 text-slate-400"
                    role="note"
                  >
                    This conversation has ended. When the customer writes again, a new
                    conversation starts with the same context.
                  </p>
                ) : (
                  <>
                    {selectedSession.status === "ACTIVE" ? (
                      <p className="mb-2 inline-flex items-center gap-1.5 px-1 text-xs text-slate-400">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-amber-300" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M10 9v6M14 9v6" />
                        </svg>
                        Replying pauses the AI (human takeover).
                      </p>
                    ) : null}
                    <div className="rounded-xl border border-white/10 bg-[#0b0b0b] transition focus-within:border-white/30">
                      <textarea
                        value={replyValue}
                        onChange={(event) => setReplyValue(event.target.value)}
                        onKeyDown={handleReplyKeyDown}
                        disabled={isSending}
                        maxLength={MAX_REPLY_LENGTH}
                        rows={3}
                        aria-label={`Reply to ${customerLabel(selectedSession)}`}
                        placeholder="Write a reply..."
                        className="block w-full resize-none bg-transparent px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 disabled:opacity-60"
                      />
                      <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-2">
                        <p className="text-xs text-slate-500">
                          Enter to send, Shift+Enter for a new line
                        </p>
                        <button
                          type="button"
                          disabled={isSending || !replyValue.trim()}
                          onClick={() => void handleSendReply()}
                          className={`pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400 ${focusRing}`}
                        >
                          {isSending ? "Sending..." : "Send"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <p className="self-center text-lg text-slate-400">
              {sessions.length === 0 ? "No conversations to show" : "No conversation selected"}
            </p>
          )}
        </section>

        {selectedSession ? (
          <div
            className={`${drawerOpen ? "fixed inset-0 z-40 flex" : "hidden"} min-h-0 xl:static xl:z-auto ${
              panelCollapsed ? "xl:hidden" : "xl:flex"
            }`}
            role={drawerOpen ? "dialog" : undefined}
            aria-modal={drawerOpen ? true : undefined}
            aria-label={drawerOpen ? "Customer and context" : undefined}
          >
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={() => setDrawerOpen(false)}
              className="min-w-0 flex-1 cursor-default bg-black/70 backdrop-blur-sm xl:hidden"
            />
            <aside
              id="chat-context-panel"
              aria-label="Customer and context"
              className="flex h-full w-full max-w-md shrink-0 flex-col border-l border-white/10 bg-black xl:max-w-none"
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                <h2 className="text-sm font-semibold text-white">Customer &amp; context</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setContextReloadToken((value) => value + 1)}
                    disabled={isContextFetching}
                    aria-label="Refresh customer context"
                    title="Refresh"
                    className={iconButtonClass()}
                  >
                    {isContextFetching ? <Spinner /> : <RefreshIcon className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    ref={drawerCloseRef}
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Close customer and context"
                    className={iconButtonClass({ display: "inline-flex xl:hidden" })}
                  >
                    <CloseIcon />
                  </button>
                  <button
                    type="button"
                    onClick={togglePanelCollapsed}
                    aria-label="Hide customer and context"
                    title="Hide"
                    className={iconButtonClass({ display: "hidden xl:inline-flex" })}
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ContextPanel
                  key={selectedSession.id}
                  session={selectedSession}
                  context={selectedContext?.data ?? null}
                  error={selectedContext?.error ?? ""}
                  crossChannelMemory={crossChannelMemory}
                  formatters={formatters}
                  now={clock?.now ?? null}
                  summaryPending={summaryForSelected?.pending ?? false}
                  summaryError={summaryForSelected?.error ?? ""}
                  onSummarise={() => void handleSummarise()}
                  onRetry={() => setContextReloadToken((value) => value + 1)}
                  onRefreshContext={() => setContextReloadToken((value) => value + 1)}
                  onOpenSession={openSession}
                />
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}
