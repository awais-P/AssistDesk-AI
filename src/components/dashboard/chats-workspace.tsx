"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

export type ChatAttachmentItem = {
  url: string;
  name: string;
  mimeType: string;
  size: number | null;
};

type ChatSender = "USER" | "AI" | "AGENT" | "SYSTEM";
type ChatStatus = "ACTIVE" | "ESCALATED" | "CLOSED";

type ChatMessageItem = {
  id: string;
  sender: ChatSender;
  content: string;
  authorName: string | null;
  attachments: ChatAttachmentItem[];
  createdAt: string;
};

type ChatSessionItem = {
  id: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  status: ChatStatus;
  channel: string;
  startedAt: string;
  updatedAt: string;
  chatbotName: string | null;
  integrationName: string | null;
  integrationType: string | null;
  messages: ChatMessageItem[];
};

type ChatsWorkspaceProps = {
  initialSessions: ChatSessionItem[];
};

type LocalOverrides = {
  source: ChatSessionItem[];
  statuses: Record<string, ChatStatus>;
  notices: Record<string, ChatMessageItem[]>;
};

type ReplyResponse = {
  error?: string;
  message?: {
    id: string;
    sender: ChatSender;
    content: string;
    authorName: string | null;
    attachments: ChatAttachmentItem[];
    createdAt: string;
  };
  delivery?: {
    status: "SENT" | "FAILED" | "NOT_APPLICABLE";
    error: string | null;
  };
};

const REFRESH_INTERVAL_MS = 10 * 1000;
const MAX_REPLY_LENGTH = 4000;

const statusNotices: Record<ChatStatus, string> = {
  ESCALATED: "You joined the conversation.",
  ACTIVE: "The AI assistant is back in the conversation.",
  CLOSED: "This conversation was closed.",
};

function customerLabel(session: ChatSessionItem) {
  return (
    session.customerName ||
    session.customerEmail ||
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

  return "Web";
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

function messagePreview(session: ChatSessionItem) {
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

function lastActivityAt(session: ChatSessionItem) {
  return session.messages[session.messages.length - 1]?.createdAt ?? session.updatedAt;
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "SLACK") {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M9 4v16M15 4v16M4 9h16M4 15h16" />
      </svg>
    );
  }

  if (channel === "WHATSAPP") {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8Z" />
        <path d="M9.5 9.5c.5 2 2 3.5 4 4" />
      </svg>
    );
  }

  if (channel === "EMAIL") {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 6h16v12H4z" />
        <path d="m5 7 7 6 7-6" />
      </svg>
    );
  }

  if (channel === "VOICE") {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
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

export function ChatsWorkspace({ initialSessions }: ChatsWorkspaceProps) {
  const router = useRouter();
  const latestSessionsRef = useRef(initialSessions);
  const threadRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(initialSessions[0]?.id ?? "");
  const [showThreadOnMobile, setShowThreadOnMobile] = useState(false);
  const [sentMessages, setSentMessages] = useState<Record<string, ChatMessageItem[]>>({});
  const [overrides, setOverrides] = useState<LocalOverrides>({
    source: initialSessions,
    statuses: {},
    notices: {},
  });
  const [replyValue, setReplyValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<ChatStatus | null>(null);
  const [error, setError] = useState("");
  const [deliveryWarning, setDeliveryWarning] = useState<{
    sessionId: string;
    text: string;
  } | null>(null);
  const [clock, setClock] = useState<{ now: number; timeZone: string } | null>(null);

  useEffect(() => {
    latestSessionsRef.current = initialSessions;
  }, [initialSessions]);

  // Dates are only rendered after mount, in the browser's time zone, so the
  // server and client markup always match.
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tick = () => setClock({ now: Date.now(), timeZone });

    tick();
    const interval = window.setInterval(tick, 30 * 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    function refreshIfVisible() {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }

    const interval = window.setInterval(refreshIfVisible, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [router]);

  const formatters = useMemo(() => {
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

  // Server props are the source of truth; local additions are merged by message id
  // so a refresh never duplicates them. Status overrides and local system notices
  // only apply until the next set of props arrives (which already contains them).
  const sessions = useMemo(() => {
    const activeOverrides = overrides.source === initialSessions ? overrides : null;

    return initialSessions.map((session) => {
      const knownIds = new Set(session.messages.map((message) => message.id));
      const extraMessages = [
        ...(sentMessages[session.id] ?? []),
        ...(activeOverrides?.notices[session.id] ?? []),
      ].filter((message) => !knownIds.has(message.id));

      return {
        ...session,
        status: activeOverrides?.statuses[session.id] ?? session.status,
        messages:
          extraMessages.length > 0
            ? [...session.messages, ...extraMessages]
            : session.messages,
      };
    });
  }, [initialSessions, overrides, sentMessages]);

  const filteredSessions = useMemo(() => {
    const value = search.trim().toLowerCase();

    if (!value) {
      return sessions;
    }

    return sessions.filter((session) => {
      return (
        session.customerName?.toLowerCase().includes(value) ||
        session.customerEmail?.toLowerCase().includes(value) ||
        session.customerPhone?.toLowerCase().includes(value) ||
        session.chatbotName?.toLowerCase().includes(value) ||
        session.integrationName?.toLowerCase().includes(value)
      );
    });
  }, [sessions, search]);

  const selectedSession =
    sessions.find((session) => session.id === selectedId) ??
    (selectedId ? null : sessions[0] ?? null);
  const selectedMessageCount = selectedSession?.messages.length ?? 0;

  useEffect(() => {
    const thread = threadRef.current;

    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  }, [selectedSession?.id, selectedMessageCount]);

  function applyLocalUpdate(
    sessionId: string,
    status: ChatStatus | null,
    notice: ChatMessageItem | null,
  ) {
    const source = latestSessionsRef.current;

    setOverrides((current) => {
      const base =
        current.source === source
          ? current
          : { source, statuses: {}, notices: {} };

      return {
        source,
        statuses: status
          ? { ...base.statuses, [sessionId]: status }
          : base.statuses,
        notices: notice
          ? {
              ...base.notices,
              [sessionId]: [...(base.notices[sessionId] ?? []), notice],
            }
          : base.notices,
      };
    });
  }

  function selectSession(sessionId: string) {
    if (sessionId !== selectedSession?.id) {
      setReplyValue("");
      setError("");
    }

    setSelectedId(sessionId);
    setShowThreadOnMobile(true);
  }

  async function handleSendReply() {
    if (!selectedSession || isSending) {
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

      if (session.status === "CLOSED") {
        applyLocalUpdate(session.id, "ACTIVE", null);
      }

      setReplyValue("");

      if (data.delivery?.status === "FAILED") {
        setDeliveryWarning({
          sessionId: session.id,
          text: `Saved, but it could not be delivered to ${channelLabel(session.channel)}: ${
            data.delivery.error || "unknown error"
          }`,
        });
      }

      router.refresh();
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
      };

      if (!response.ok || !data.success) {
        setError(data.error ?? "Unable to update this conversation.");
        return;
      }

      applyLocalUpdate(session.id, status, {
        id: `local-${status}-${Date.now()}`,
        sender: "SYSTEM",
        content: statusNotices[status],
        authorName: null,
        attachments: [],
        createdAt: new Date().toISOString(),
      });
      router.refresh();
    } catch {
      setError("Something went wrong while updating this conversation.");
    } finally {
      setPendingStatus(null);
    }
  }

  function handleReplyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleSendReply();
    }
  }

  const actionButtonClass =
    "pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-60";

  return (
    <div className="h-[100dvh] overflow-hidden px-0 py-0 lg:h-[calc(100vh-32px)]">
      <div className="grid h-full grid-rows-[minmax(0,1fr)] lg:grid-cols-[360px_1fr]">
        <aside
          className={`${
            showThreadOnMobile ? "hidden" : "flex"
          } min-h-0 flex-col border-r border-white/10 bg-black lg:flex`}
        >
          <div className="border-b border-white/10 p-4">
            <div className="inline-flex h-12 w-full items-center rounded-lg border border-white/10 bg-[#111111] px-3">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3-3" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search..."
                aria-label="Search conversations"
                className="ml-3 w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <p className="px-4 py-8 text-sm leading-6 text-slate-400">
                No conversations yet. Embed your chatbot or connect Slack/WhatsApp in
                Integrations.
              </p>
            ) : filteredSessions.length === 0 ? (
              <p className="px-4 py-8 text-sm text-slate-400">
                No conversations match your search.
              </p>
            ) : (
              filteredSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => selectSession(session.id)}
                  aria-current={selectedSession?.id === session.id ? "true" : undefined}
                  className={`w-full border-b border-white/5 px-4 py-4 text-left transition ${
                    selectedSession?.id === session.id
                      ? "bg-white/[0.04]"
                      : "hover:bg-white/[0.02]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate font-semibold text-white">
                      {customerLabel(session)}
                    </p>
                    <span className="shrink-0 text-xs text-slate-500">
                      {clock && formatters
                        ? formatRelativeTime(lastActivityAt(session), clock.now, formatters.date)
                        : null}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-400">
                    {messagePreview(session)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <ChannelBadge channel={session.channel} />
                    <StatusBadge status={session.status} />
                  </div>
                </button>
              ))
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
                <button
                  type="button"
                  onClick={() => setShowThreadOnMobile(false)}
                  className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-white lg:hidden"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="m15 6-6 6 6 6" />
                  </svg>
                  Back to conversations
                </button>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-xl font-semibold text-white">
                      {customerLabel(selectedSession)}
                    </p>
                    <p className="mt-2 truncate text-sm text-slate-400">
                      {[
                        selectedSession.customerEmail,
                        selectedSession.customerPhone,
                        selectedSession.integrationName || selectedSession.chatbotName,
                      ]
                        .filter(Boolean)
                        .join(" • ") || "No contact details provided"}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ChannelBadge channel={selectedSession.channel} />
                      <StatusBadge status={selectedSession.status} />
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {selectedSession.status === "ACTIVE" ? (
                      <button
                        type="button"
                        disabled={pendingStatus !== null}
                        onClick={() => void handleStatusChange("ESCALATED")}
                        className="pressable inline-flex items-center justify-center rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
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
                    {selectedSession.status === "CLOSED" ? (
                      <button
                        type="button"
                        disabled={pendingStatus !== null}
                        onClick={() => void handleStatusChange("ACTIVE")}
                        className={actionButtonClass}
                      >
                        {pendingStatus === "ACTIVE" ? "Reopening..." : "Reopen"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={pendingStatus !== null}
                        onClick={() => void handleStatusChange("CLOSED")}
                        className={actionButtonClass}
                      >
                        {pendingStatus === "CLOSED" ? "Closing..." : "Close"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div
                ref={threadRef}
                className="min-h-0 flex-1 space-y-4 overflow-y-auto py-6"
                aria-live="polite"
              >
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
                  <p className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
                  </p>
                ) : null}

                {deliveryWarning?.sessionId === selectedSession.id ? (
                  <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    {deliveryWarning.text}
                  </p>
                ) : null}

                <div className="rounded-xl border border-white/10 bg-[#0b0b0b]">
                  <textarea
                    value={replyValue}
                    onChange={(event) => setReplyValue(event.target.value)}
                    onKeyDown={handleReplyKeyDown}
                    disabled={isSending}
                    maxLength={MAX_REPLY_LENGTH}
                    rows={3}
                    aria-label={`Reply to ${customerLabel(selectedSession)}`}
                    placeholder={
                      selectedSession.status === "ACTIVE"
                        ? "Write a reply... The AI is still active; take over to pause it."
                        : "Write a reply..."
                    }
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
                      className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
                    >
                      {isSending ? "Sending..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="self-center text-lg text-slate-400">
              {sessions.length === 0 ? "No conversations yet" : "No conversation selected"}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
