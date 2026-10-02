"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { defaultChatbotWelcomeMessage } from "@/src/lib/chatbot-config";
import type { PublicLeadForm } from "@/src/lib/lead-form";
import {
  WIDGET_MESSAGE_TYPE,
  WIDGET_SESSION_HEADER,
  WIDGET_TOKEN_HEADER,
} from "@/src/lib/widget-constants";

type WidgetAttachment = {
  url: string;
  name: string;
  mimeType: string;
  size: number;
};

type WidgetMessage = {
  id: string;
  sender: string;
  content: string;
  attachments: WidgetAttachment[];
  authorName: string | null;
  createdAt: string;
  /** Module 6 FE-3: the visitor's own rating of an AI reply (1 / -1), when known. */
  rating?: number | null;
};

type WidgetConfig = {
  id: string;
  name: string;
  widgetId: string;
  welcomeMessage: string | null;
  primaryColor: string;
  avatarUrl: string | null;
  conversationStarters: string[];
  isActive: boolean;
  widgetPosition: string;
  requireName: boolean;
  requireEmail: boolean;
  requirePhone: boolean;
  emailNotifications: boolean;
  agentName: string;
  online: boolean;
  operatorsOnline: boolean;
  isPreview: boolean;
  sessionTimeoutMinutes?: number;
  leadForm?: PublicLeadForm | null;
};

/** Module 8: the inline lead form the server asked the widget to show. */
type LeadPrompt = {
  form: PublicLeadForm;
  prefill: Record<string, string>;
};

/** The visitor's conversation as the server reports it (Module 5 session lifecycle). */
type WidgetSessionState = {
  id: string;
  status: "ACTIVE" | "ESCALATED" | "CLOSED";
  startedAt: string;
  lastActivityAt: string;
  expiresAt: string | null;
  idleTimeoutMinutes: number;
  closedReason: string | null;
  continuesPrevious: boolean;
};

type ContactState = {
  name: string;
  email: string;
  phone: string;
};

type ChatbotWidgetClientProps = {
  widgetId: string;
  token: string;
  isPreview: boolean;
};

type SpeechRecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

/** Only used when live updates (Server-Sent Events) are unavailable. */
const POLL_INTERVAL_MS = 4000;
const MAX_STREAM_FAILURES = 3;
const EXPIRY_WARNING_MS = 5 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 2000;
const DIVIDER_SENDER = "DIVIDER";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^[+()\d\s-]{6,20}$/;
const emojis = [
  "😀", "😂", "😊", "😍", "🤔", "😅", "😢", "😡",
  "👍", "👎", "👏", "🙏", "🙌", "💪", "👋", "🤝",
  "❤️", "🔥", "🎉", "✅", "❌", "⭐", "💡", "📦",
  "💳", "📅", "📞", "📧", "🚚", "🛒", "⏰", "❓",
];

const iconButtonClass =
  "flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40";

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getMissingContactFields(config: WidgetConfig, contact: ContactState) {
  const missing: string[] = [];

  if (config.requireName && !contact.name.trim()) missing.push("name");
  if (config.requireEmail && !contact.email.trim()) missing.push("email");
  if (config.requirePhone && !contact.phone.trim()) missing.push("phone number");

  return missing;
}

function validateContact(contact: ContactState) {
  if (contact.email.trim() && !EMAIL_PATTERN.test(contact.email.trim())) {
    return "Please enter a valid email, like name@example.com.";
  }

  if (contact.phone.trim() && !PHONE_PATTERN.test(contact.phone.trim())) {
    return "Please enter a valid phone number (digits, spaces, + and - only).";
  }

  return "";
}

function usePersistedState<T>(key: string, initialValue: T) {
  const [state, setState] = useState(initialValue);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    try {
      const rawValue = window.localStorage.getItem(key);

      if (rawValue) {
        setState(JSON.parse(rawValue) as T);
      }
    } catch {}

    setIsHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [isHydrated, key, state]);

  return [state, setState, isHydrated] as const;
}

/** Anonymous id for this browser, so a returning visitor is recognised (FE-2). */
function createVisitorId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newConversationDivider(sessionId: string, createdAt: string): WidgetMessage {
  return {
    id: `divider-${sessionId}`,
    sender: DIVIDER_SENDER,
    content: "New conversation — we still remember what we talked about.",
    attachments: [],
    authorName: null,
    createdAt,
  };
}

function formatMinutes(minutes: number) {
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function mergeMessages(current: WidgetMessage[], incoming: WidgetMessage[]) {
  const byId = new Map(
    current.filter((message) => !message.id.startsWith("pending-")).map((message) => [message.id, message]),
  );

  for (const message of incoming) {
    byId.set(message.id, message);
  }

  const pending = current.filter((message) => message.id.startsWith("pending-"));

  return [...Array.from(byId.values()), ...pending].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

function MessageBody({ message }: { message: WidgetMessage }) {
  if (message.sender === "USER") {
    return <p className="whitespace-pre-wrap break-words">{message.content}</p>;
  }

  return (
    <div className="break-words [&>*+*]:mt-2">
      <ReactMarkdown
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="font-medium underline">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          code: ({ children }) => (
            <code className="rounded bg-slate-200/70 px-1 py-0.5 text-[0.85em]">{children}</code>
          ),
          h1: ({ children }) => <p className="font-semibold">{children}</p>,
          h2: ({ children }) => <p className="font-semibold">{children}</p>,
          h3: ({ children }) => <p className="font-semibold">{children}</p>,
          img: () => null,
        }}
      >
        {message.content}
      </ReactMarkdown>
    </div>
  );
}

function AttachmentList({ attachments }: { attachments: WidgetAttachment[] }) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-2">
      {attachments.map((attachment) =>
        attachment.mimeType.startsWith("image/") ? (
          <a key={attachment.url} href={attachment.url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachment.url}
              alt={attachment.name}
              className="max-h-44 rounded-xl border border-slate-200 object-cover"
            />
          </a>
        ) : (
          <a
            key={attachment.url}
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          >
            <span aria-hidden="true">📎</span>
            <span className="truncate">{attachment.name}</span>
            <span className="text-slate-400">{formatFileSize(attachment.size)}</span>
          </a>
        ),
      )}
    </div>
  );
}

export function ChatbotWidgetClient({
  widgetId,
  token,
  isPreview,
}: ChatbotWidgetClientProps) {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [contactError, setContactError] = useState("");
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<WidgetAttachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [operatorsOnline, setOperatorsOnline] = useState(false);
  const [contactDismissed, setContactDismissed] = useState(false);
  const [contactDraft, setContactDraft] = useState<ContactState>({ name: "", email: "", phone: "" });
  // Module 5: the secret session token identifies this visitor's conversation; the
  // server stores only its hash. The visitor id lets a returning visitor be recognised.
  const [sessionToken, setSessionToken, sessionTokenHydrated] = usePersistedState<string | null>(
    `assistdesk-widget-session-token-${widgetId}`,
    null,
  );
  const [visitorId, setVisitorId, visitorIdHydrated] = usePersistedState<string | null>(
    `assistdesk-widget-visitor-${widgetId}`,
    null,
  );
  const [session, setSession] = useState<WidgetSessionState | null>(null);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [liveUpdates, setLiveUpdates] = useState(true);
  const [leadPrompt, setLeadPrompt] = useState<LeadPrompt | null>(null);
  const [leadValues, setLeadValues] = useState<Record<string, string>>({});
  const [leadErrors, setLeadErrors] = useState<Record<string, string>>({});
  const [leadConsent, setLeadConsent] = useState(false);
  const [isSubmittingLead, setIsSubmittingLead] = useState(false);
  // 👍 / 👎 per AI reply, and the optional "what was missing?" note after a 👎.
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [contact, setContact, contactHydrated] = usePersistedState<ContactState>(
    `assistdesk-widget-contact-${widgetId}`,
    { name: "", email: "", phone: "" },
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const sessionTokenRef = useRef<string | null>(null);

  useEffect(() => {
    sessionTokenRef.current = sessionToken;
  }, [sessionToken]);

  const widgetFetch = useCallback(
    (path: string, init?: RequestInit) =>
      fetch(path, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          [WIDGET_TOKEN_HEADER]: token,
          ...(sessionTokenRef.current ? { [WIDGET_SESSION_HEADER]: sessionTokenRef.current } : {}),
        },
      }),
    [token],
  );

  useEffect(() => {
    if (visitorIdHydrated && !visitorId) {
      setVisitorId(createVisitorId());
    }
  }, [setVisitorId, visitorId, visitorIdHydrated]);

  useEffect(() => {
    // Sessions used to be stored by id; that key is no longer read.
    try {
      window.localStorage.removeItem(`assistdesk-widget-session-${widgetId}`);
    } catch {}
  }, [widgetId]);

  // Ticks the expiry warning and the rate-limit cooldown.
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) {
      return;
    }

    const timeout = window.setTimeout(() => setNow(Date.now()), cooldownUntil - Date.now() + 50);
    return () => window.clearTimeout(timeout);
  }, [cooldownUntil]);

  useEffect(() => {
    if (contactHydrated) {
      setContactDraft(contact);
    }
    // Only seed the form once, after the saved contact has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactHydrated]);

  useEffect(() => {
    const speechWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    setSpeechSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));

    return () => recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    async function loadConfig() {
      setIsLoadingConfig(true);

      try {
        const response = await widgetFetch(`/api/widget/${widgetId}`);
        const data = (await response.json()) as {
          error?: string;
          chatbot?: WidgetConfig;
        };

        if (!response.ok || !data.chatbot) {
          setError(data.error ?? "Unable to load the chat right now. Please reload the page.");
          return;
        }

        setConfig(data.chatbot);
        setOperatorsOnline(data.chatbot.operatorsOnline);
        window.parent.postMessage(
          {
            type: WIDGET_MESSAGE_TYPE,
            action: "config",
            primaryColor: data.chatbot.primaryColor,
            position: data.chatbot.widgetPosition,
            avatarUrl: data.chatbot.avatarUrl,
          },
          "*",
        );
      } catch {
        setError("Something went wrong while loading the chat. Check your connection and reload.");
      } finally {
        setIsLoadingConfig(false);
      }
    }

    void loadConfig();
  }, [widgetFetch, widgetId]);

  const loadHistory = useCallback(async () => {
    if (!sessionTokenRef.current) {
      return;
    }

    try {
      const response = await widgetFetch(`/api/widget/${widgetId}/messages`);
      const data = (await response.json()) as {
        messages?: WidgetMessage[];
        operatorsOnline?: boolean;
        session?: WidgetSessionState | null;
        leadPrompt?: LeadPrompt | null;
      };

      if (!response.ok) {
        return;
      }

      if (typeof data.operatorsOnline === "boolean") {
        setOperatorsOnline(data.operatorsOnline);
      }

      if (!data.session) {
        // Unknown or foreign token: start fresh on the next message.
        setSessionToken(null);
        setSession(null);
        setMessages([]);
        return;
      }

      setSession(data.session);
      setMessages((current) => mergeMessages(current, data.messages ?? []));
      setRatings((current) => {
        const next = { ...current };

        for (const message of data.messages ?? []) {
          if (typeof message.rating === "number") {
            next[message.id] = message.rating;
          }
        }

        return next;
      });
      setLeadPrompt(data.leadPrompt ?? null);
    } catch {
      // Retried on the next tick / reconnect.
    }
  }, [setSessionToken, widgetFetch, widgetId]);

  useEffect(() => {
    if (sessionTokenHydrated) {
      void loadHistory();
    }
  }, [loadHistory, sessionToken, sessionTokenHydrated]);

  const sessionOpen = Boolean(sessionToken) && session !== null && session.status !== "CLOSED";

  // Live updates (Server-Sent Events): team replies, AI fallbacks, takeover and expiry
  // arrive as they happen. EventSource reconnects by itself; after repeated failures
  // the widget falls back to polling.
  useEffect(() => {
    if (!sessionOpen || !sessionToken || !liveUpdates || typeof EventSource === "undefined") {
      return;
    }

    let source: EventSource | null = null;
    let failures = 0;
    let reconnectTimer: number | undefined;
    let stopped = false;

    const connect = () => {
      const params = new URLSearchParams({ token, session: sessionToken });
      source = new EventSource(`/api/widget/${widgetId}/stream?${params.toString()}`);

      source.addEventListener("open", () => {
        failures = 0;
      });
      source.addEventListener("message", (event) => {
        try {
          const incoming = JSON.parse((event as MessageEvent<string>).data) as WidgetMessage[];
          setMessages((current) => mergeMessages(current, incoming));
        } catch {}
      });
      source.addEventListener("session", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as {
            session: WidgetSessionState;
            operatorsOnline: boolean;
          };
          setSession(data.session);
          setOperatorsOnline(data.operatorsOnline);
        } catch {}
      });
      source.addEventListener("error", () => {
        if (source?.readyState !== EventSource.CLOSED || stopped) {
          return; // The browser is already reconnecting.
        }

        failures += 1;

        if (failures >= MAX_STREAM_FAILURES) {
          setLiveUpdates(false);
          return;
        }

        reconnectTimer = window.setTimeout(connect, 3000 * failures);
      });
    };

    connect();

    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [liveUpdates, sessionOpen, sessionToken, token, widgetId]);

  // Polling fallback when live updates are not available.
  useEffect(() => {
    if (!sessionOpen || (liveUpdates && typeof EventSource !== "undefined")) {
      return;
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadHistory();
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [liveUpdates, loadHistory, sessionOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isSending]);

  // Module 8 FE-1: the lead form is prefilled with what we already know about the visitor.
  const leadFieldValues = useMemo(() => {
    if (!leadPrompt) {
      return {};
    }

    const known: Record<string, string> = { name: contact.name, email: contact.email, phone: contact.phone };

    return Object.fromEntries(
      leadPrompt.form.fields.map((field) => [
        field.key,
        leadValues[field.key] ?? (leadPrompt.prefill[field.key] || known[field.key] || ""),
      ]),
    );
  }, [contact.email, contact.name, contact.phone, leadPrompt, leadValues]);

  const missingContactFields = useMemo(
    () => (config ? getMissingContactFields(config, contact) : []),
    [config, contact],
  );
  const showContactCard =
    Boolean(config) &&
    contactHydrated &&
    (missingContactFields.length > 0 ||
      (Boolean(config?.emailNotifications) && !contact.email.trim() && !contactDismissed));

  function saveContact() {
    const nextContact = {
      name: contactDraft.name.trim(),
      email: contactDraft.email.trim(),
      phone: contactDraft.phone.trim(),
    };
    const validationError = validateContact(nextContact);

    if (validationError) {
      setContactError(validationError);
      return;
    }

    if (config) {
      const stillMissing = getMissingContactFields(config, nextContact);

      if (stillMissing.length > 0) {
        setContactError(`Please add your ${stillMissing.join(" and ")} to start chatting.`);
        return;
      }
    }

    setContact(nextContact);
    setContactError("");
    setContactDismissed(true);
  }

  async function sendMessage(rawContent: string) {
    const content = rawContent.trim();

    if (!config || (!content && pendingAttachments.length === 0) || isSending || isUploading) {
      return;
    }

    if (cooldownUntil > Date.now()) {
      return;
    }

    if (missingContactFields.length > 0) {
      setContactError(`Please add your ${missingContactFields.join(" and ")} first.`);
      return;
    }

    if (content.length > MAX_MESSAGE_LENGTH) {
      setError(`Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`);
      return;
    }

    const attachments = pendingAttachments;
    const pendingUserMessage: WidgetMessage = {
      id: `pending-${Date.now()}`,
      sender: "USER",
      content,
      attachments,
      authorName: contact.name || null,
      createdAt: new Date().toISOString(),
    };

    setMessages((current) => [...current, pendingUserMessage]);
    setDraft("");
    setPendingAttachments([]);
    setEmojiOpen(false);
    setError("");
    setIsSending(true);

    try {
      const response = await widgetFetch(`/api/widget/${widgetId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          attachments,
          customerName: contact.name,
          customerEmail: contact.email,
          customerPhone: contact.phone,
          visitorId,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        retryAfterSeconds?: number;
        session?: WidgetSessionState;
        sessionToken?: string | null;
        sessionStarted?: boolean;
        previousSession?: { id: string; closedReason: string | null } | null;
        messages?: WidgetMessage[];
        leadPrompt?: LeadPrompt | null;
      };

      if (!response.ok || !data.session || !data.messages) {
        setMessages((current) => current.filter((message) => message.id !== pendingUserMessage.id));
        setDraft(content);
        setPendingAttachments(attachments);
        setError(data.error ?? "Your message was not sent. Please try again.");

        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("Retry-After")) || data.retryAfterSeconds || 30;
          setCooldownUntil(Date.now() + retryAfter * 1000);
        }

        return;
      }

      const nextMessages = data.messages;
      const nextSession = data.session;
      // A closed or expired conversation was followed by a new one.
      const startedAfterPrevious = Boolean(data.sessionStarted && data.previousSession);

      if (data.sessionToken) {
        sessionTokenRef.current = data.sessionToken;
        setSessionToken(data.sessionToken);
      }

      setSession(nextSession);
      setLiveUpdates(true);
      setMessages((current) => {
        const withoutPending = current.filter((message) => message.id !== pendingUserMessage.id);
        const divider =
          startedAfterPrevious && withoutPending.length > 0
            ? [newConversationDivider(nextSession.id, nextSession.startedAt)]
            : [];

        return mergeMessages(withoutPending, [...divider, ...nextMessages]);
      });
      setLeadPrompt(data.leadPrompt ?? null);
    } catch {
      setMessages((current) => current.filter((message) => message.id !== pendingUserMessage.id));
      setDraft(content);
      setPendingAttachments(attachments);
      setError("Your message was not sent. Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  }

  async function rateMessage(messageId: string, rating: 1 | -1 | 0, comment?: string) {
    const previous = ratings[messageId];

    setRatings((current) => {
      const next = { ...current };
      if (rating === 0) delete next[messageId];
      else next[messageId] = rating;
      return next;
    });

    try {
      const response = await widgetFetch(`/api/widget/${widgetId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, rating, ...(comment ? { comment } : {}) }),
      });

      if (!response.ok) {
        throw new Error("rating failed");
      }

      if (rating === -1 && !comment) {
        setCommentFor(messageId);
        setCommentDraft("");
      } else {
        setCommentFor(null);
      }
    } catch {
      setRatings((current) => {
        const next = { ...current };
        if (previous === undefined) delete next[messageId];
        else next[messageId] = previous;
        return next;
      });
      setError("Your rating was not saved. Please try again.");
    }
  }

  async function answerLeadForm(skip: boolean) {
    if (!leadPrompt || isSubmittingLead) {
      return;
    }

    setIsSubmittingLead(true);
    setLeadErrors({});
    setError("");

    try {
      const response = await widgetFetch(`/api/widget/${widgetId}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skip ? { skip: true } : { values: leadFieldValues, consent: leadConsent }),
      });
      const data = (await response.json()) as {
        error?: string;
        fieldErrors?: Record<string, string>;
        session?: WidgetSessionState | null;
        messages?: WidgetMessage[];
        contact?: { name: string | null; email: string | null; phone: string | null };
      };

      if (!response.ok) {
        setLeadErrors(data.fieldErrors ?? {});
        setError(data.error ?? "The form could not be sent. Please try again.");
        return;
      }

      setLeadPrompt(null);
      setLeadValues({});

      if (data.session) {
        setSession(data.session);
      }

      if (data.contact) {
        const shared = data.contact;
        setContact((current) => ({
          name: shared.name ?? current.name,
          email: shared.email ?? current.email,
          phone: shared.phone ?? current.phone,
        }));
      }

      setMessages((current) => mergeMessages(current, data.messages ?? []));
    } catch {
      setError("The form could not be sent. Check your connection and try again.");
    } finally {
      setIsSubmittingLead(false);
    }
  }

  async function handleFileSelected(file: File | undefined) {
    if (!file) {
      return;
    }

    if (pendingAttachments.length >= 3) {
      setError("You can attach up to 3 files per message.");
      return;
    }

    setIsUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await widgetFetch(`/api/widget/${widgetId}/attachments`, {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { error?: string; attachment?: WidgetAttachment };

      if (!response.ok || !data.attachment) {
        setError(data.error ?? "This file could not be uploaded.");
        return;
      }

      setPendingAttachments((current) => [...current, data.attachment as WidgetAttachment]);
    } catch {
      setError("This file could not be uploaded. Check your connection and try again.");
    } finally {
      setIsUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function toggleDictation() {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const speechWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

    if (!Recognition) {
      setError("Voice typing is not supported in this browser.");
      return;
    }

    const recognition = new Recognition();
    const baseDraft = draft ? `${draft.trimEnd()} ` : "";
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let transcript = "";

      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }

      setDraft(`${baseDraft}${transcript}`.slice(0, MAX_MESSAGE_LENGTH));
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        setError("Microphone access was blocked. Allow it in your browser to use voice typing.");
      }
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }

  function closeWidget() {
    window.parent.postMessage({ type: WIDGET_MESSAGE_TYPE, action: "close" }, "*");
  }

  /** The visitor ends the conversation; their next message starts a new one. */
  async function endConversation() {
    if (!sessionToken || isEnding) {
      return;
    }

    setIsEnding(true);
    setError("");

    try {
      const response = await widgetFetch(`/api/widget/${widgetId}/session`, { method: "DELETE" });
      const data = (await response.json()) as { error?: string; session?: WidgetSessionState | null };

      if (!response.ok) {
        setError(data.error ?? "The conversation could not be ended. Please try again.");
        return;
      }

      if (data.session) {
        setSession(data.session);
      }

      await loadHistory();
    } catch {
      setError("The conversation could not be ended. Check your connection and try again.");
    } finally {
      setIsEnding(false);
      setConfirmingEnd(false);
    }
  }

  if (isLoadingConfig) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm text-slate-500">
        Loading chat…
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6 text-center text-sm text-red-500">
        {error || "Unable to load this chat widget."}
      </div>
    );
  }

  const statusLabel = !config.isActive
    ? "Paused"
    : operatorsOnline
      ? "Online — team available"
      : config.online
        ? "Online"
        : "Offline";
  const statusDotClass = !config.isActive
    ? "bg-slate-300"
    : operatorsOnline || config.online
      ? "bg-emerald-400"
      : "bg-orange-400";
  // While the lead form is open the assistant waits for it (SRS: AI paused).
  const inputDisabled = !config.isActive || missingContactFields.length > 0 || Boolean(leadPrompt);
  const coolingDown = cooldownUntil > now;
  const expiresInMs = sessionOpen && session?.expiresAt ? new Date(session.expiresAt).getTime() - now : null;
  const showExpiryWarning = expiresInMs !== null && expiresInMs > 0 && expiresInMs <= EXPIRY_WARNING_MS;
  const conversationEnded = Boolean(sessionToken) && session?.status === "CLOSED";

  return (
    <div className="flex h-screen flex-col bg-white text-[#111827]">
      <header
        className="relative shrink-0 overflow-hidden rounded-b-[26px] px-6 pb-5 pt-6 text-white"
        style={{ backgroundColor: config.primaryColor }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {config.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={config.avatarUrl}
                alt=""
                className="h-11 w-11 rounded-full border-2 border-white/40 object-cover"
              />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-lg font-semibold">
                {config.name.charAt(0).toUpperCase()}
              </span>
            )}
            <div>
              <p className="text-xl font-semibold leading-tight">{config.name}</p>
              <div className="mt-1.5 flex items-center gap-2 text-sm text-white/90">
                <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass}`} />
                <span>{statusLabel}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {sessionOpen && messages.length > 0 ? (
              <button
                type="button"
                onClick={() => setConfirmingEnd((current) => !current)}
                className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium text-white/90 transition hover:bg-white/10"
                aria-expanded={confirmingEnd}
              >
                End chat
              </button>
            ) : null}
            <button
              type="button"
              onClick={closeWidget}
              className="rounded-full p-2 text-white/90 transition hover:bg-white/10"
              aria-label="Close chat window"
              title="Close the window — your conversation stays open"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="m7 7 10 10M17 7 7 17" />
              </svg>
            </button>
          </div>
        </div>

        {confirmingEnd && sessionOpen ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/15 px-4 py-3 text-sm">
            <span>End this conversation?</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingEnd(false)}
                className="rounded-full px-3 py-1 text-xs font-medium text-white/90 hover:bg-white/10"
              >
                Keep chatting
              </button>
              <button
                type="button"
                disabled={isEnding}
                onClick={() => void endConversation()}
                className="rounded-full bg-white px-3 py-1 text-xs font-semibold disabled:opacity-60"
                style={{ color: config.primaryColor }}
              >
                {isEnding ? "Ending…" : "End chat"}
              </button>
            </div>
          </div>
        ) : null}
      </header>

      {isPreview ? (
        <p className="shrink-0 bg-amber-50 px-5 py-2 text-center text-xs text-amber-800">
          Preview mode — only your team can open this link. Customers use the embed code.
        </p>
      ) : null}

      <main
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
        aria-live="polite"
      >
        <div className="flex justify-start">
          <div className="max-w-[82%] rounded-[22px] bg-[#eef4ff] px-5 py-3 text-sm leading-6 text-slate-700 shadow-sm">
            {config.welcomeMessage || defaultChatbotWelcomeMessage}
          </div>
        </div>

        {messages.length === 0 && config.conversationStarters.length > 0 && !inputDisabled ? (
          <div className="flex flex-wrap justify-end gap-2">
            {config.conversationStarters.map((starter) => (
              <button
                key={starter}
                type="button"
                disabled={isSending}
                onClick={() => void sendMessage(starter)}
                className="rounded-full border px-3.5 py-2 text-left text-sm transition hover:bg-slate-50"
                style={{ borderColor: config.primaryColor, color: config.primaryColor }}
              >
                {starter}
              </button>
            ))}
          </div>
        ) : null}

        {messages.map((message) => {
          if (message.sender === DIVIDER_SENDER) {
            return (
              <div key={message.id} className="flex items-center gap-3 py-1 text-[11px] text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-center">{message.content}</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            );
          }

          if (message.sender === "SYSTEM") {
            return (
              <p key={message.id} className="px-4 text-center text-xs text-slate-400">
                {message.content}
              </p>
            );
          }

          const isUser = message.sender === "USER";
          const isPending = message.id.startsWith("pending-");

          return (
            <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[82%]">
                {!isUser && message.sender === "AGENT" && message.authorName ? (
                  <p className="mb-1 pl-2 text-xs font-medium text-slate-500">{message.authorName}</p>
                ) : null}
                <div
                  className={`rounded-[22px] px-5 py-3 text-sm leading-6 shadow-sm ${
                    isUser ? "bg-[#f2f4f8] text-slate-800" : "bg-[#eef4ff] text-slate-700"
                  } ${isPending ? "opacity-70" : ""}`}
                >
                  {message.content ? <MessageBody message={message} /> : null}
                  <AttachmentList attachments={message.attachments} />
                </div>
                <div
                  className={`mt-1.5 flex items-center gap-2 text-xs text-slate-400 ${
                    isUser ? "justify-end" : "justify-start"
                  }`}
                >
                  <span>{isPending ? "Sending…" : formatTime(message.createdAt)}</span>
                  {isUser && !isPending ? (
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Delivered">
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                  ) : null}
                  {message.sender === "AI" && !isPending ? (
                    <span className="ml-1 flex items-center gap-0.5" role="group" aria-label="Was this answer helpful?">
                      {([1, -1] as const).map((value) => {
                        const active = ratings[message.id] === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            aria-label={value === 1 ? "Helpful" : "Not helpful"}
                            aria-pressed={active}
                            title={value === 1 ? "Helpful" : "Not helpful"}
                            onClick={() => void rateMessage(message.id, active ? 0 : value)}
                            className={`rounded-full p-1 transition hover:bg-slate-100 ${
                              active ? (value === 1 ? "text-emerald-600" : "text-rose-500") : "text-slate-400"
                            }`}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className={`h-3.5 w-3.5 ${value === -1 ? "rotate-180" : ""}`}
                              fill={active ? "currentColor" : "none"}
                              stroke="currentColor"
                              strokeWidth="1.8"
                              aria-hidden="true"
                            >
                              <path d="M7 11v9H4v-9h3Zm0 0 4-7c1.5 0 2.5 1 2.5 2.5V10h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.3 20H7" />
                            </svg>
                          </button>
                        );
                      })}
                    </span>
                  ) : null}
                </div>
                {commentFor === message.id ? (
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (commentDraft.trim()) {
                        void rateMessage(message.id, -1, commentDraft.trim());
                      } else {
                        setCommentFor(null);
                      }
                    }}
                  >
                    <label className="sr-only" htmlFor={`feedback-${message.id}`}>What was missing?</label>
                    <input
                      id={`feedback-${message.id}`}
                      value={commentDraft}
                      maxLength={500}
                      autoFocus
                      onChange={(event) => setCommentDraft(event.target.value)}
                      placeholder="What was missing? (optional)"
                      className="h-8 min-w-0 flex-1 rounded-full border border-slate-200 px-3 text-xs outline-none focus:border-slate-400"
                    />
                    <button
                      type="submit"
                      className="h-8 rounded-full px-3 text-xs font-medium text-white"
                      style={{ backgroundColor: config.primaryColor }}
                    >
                      {commentDraft.trim() ? "Send" : "Close"}
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          );
        })}

        {isSending ? (
          <div className="flex justify-start" aria-label={`${config.agentName} is typing`}>
            <div className="flex gap-1 rounded-[22px] bg-[#eef4ff] px-5 py-4">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-2 w-2 animate-bounce rounded-full bg-slate-400"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {leadPrompt ? (
          <section
            className="rounded-[22px] border bg-white p-4 shadow-sm"
            style={{ borderColor: `${config.primaryColor}55` }}
            aria-label="Contact form"
          >
            <p className="text-sm font-semibold text-slate-800">{leadPrompt.form.title}</p>
            {leadPrompt.form.description ? (
              <p className="mt-1 text-xs text-slate-500">{leadPrompt.form.description}</p>
            ) : null}
            <form
              className="mt-3 grid gap-2"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void answerLeadForm(false);
              }}
            >
              {leadPrompt.form.fields.map((field) => {
                const id = `lead-${field.key}`;
                const value = leadFieldValues[field.key] ?? "";
                const fieldError = leadErrors[field.key];
                const onChange = (next: string) =>
                  setLeadValues((current) => ({ ...current, [field.key]: next }));
                const fieldClass = `w-full rounded-xl border px-3 text-sm outline-none focus:border-slate-400 ${
                  fieldError ? "border-red-300" : "border-slate-200"
                }`;
                const inputType =
                  field.type === "email"
                    ? "email"
                    : field.type === "phone"
                      ? "tel"
                      : field.type === "number"
                        ? "number"
                        : "text";
                const autoComplete =
                  field.key === "name"
                    ? "name"
                    : field.key === "email"
                      ? "email"
                      : field.key === "phone"
                        ? "tel"
                        : field.key === "company"
                          ? "organization"
                          : "off";

                return (
                  <div key={field.key}>
                    <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
                      {field.label}
                      {field.required ? <span className="text-red-500"> *</span> : null}
                    </label>
                    {field.type === "textarea" ? (
                      <textarea
                        id={id}
                        value={value}
                        rows={3}
                        maxLength={1000}
                        placeholder={field.placeholder}
                        onChange={(event) => onChange(event.target.value)}
                        className={`${fieldClass} py-2`}
                        aria-invalid={Boolean(fieldError)}
                      />
                    ) : field.type === "select" ? (
                      <select
                        id={id}
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                        className={`${fieldClass} h-10 bg-white`}
                        aria-invalid={Boolean(fieldError)}
                      >
                        <option value="">Choose…</option>
                        {(field.options ?? []).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={id}
                        type={inputType}
                        value={value}
                        maxLength={200}
                        placeholder={field.placeholder}
                        autoComplete={autoComplete}
                        onChange={(event) => onChange(event.target.value)}
                        className={`${fieldClass} h-10`}
                        aria-invalid={Boolean(fieldError)}
                        aria-describedby={fieldError ? `${id}-error` : undefined}
                      />
                    )}
                    {fieldError ? (
                      <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
                        {fieldError}
                      </p>
                    ) : null}
                  </div>
                );
              })}
              {leadPrompt.form.consentText ? (
                <label className="mt-1 flex items-start gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={leadConsent}
                    onChange={(event) => setLeadConsent(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>{leadPrompt.form.consentText}</span>
                </label>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button
                  type="submit"
                  disabled={isSubmittingLead}
                  className="h-9 rounded-full px-4 text-sm font-medium text-white disabled:opacity-60"
                  style={{ backgroundColor: config.primaryColor }}
                >
                  {isSubmittingLead ? "Sending…" : leadPrompt.form.submitLabel}
                </button>
                {leadPrompt.form.allowSkip ? (
                  <button
                    type="button"
                    disabled={isSubmittingLead}
                    onClick={() => void answerLeadForm(true)}
                    className="h-9 rounded-full px-4 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-60"
                  >
                    Skip
                  </button>
                ) : null}
              </div>
            </form>
          </section>
        ) : null}

        {isSubmittingLead ? (
          <div className="flex justify-start" aria-label={`${config.agentName} is typing`}>
            <div className="flex gap-1 rounded-[22px] bg-[#eef4ff] px-5 py-4">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-2 w-2 animate-bounce rounded-full bg-slate-400"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {showContactCard && !leadPrompt ? (
          <section className="rounded-[22px] border border-slate-200 bg-[#fafbfd] p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-800">
              {missingContactFields.length > 0
                ? "Before we start, how can we reach you?"
                : "Get notified when we reply"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {missingContactFields.length > 0
                ? `We need your ${missingContactFields.join(" and ")} to continue.`
                : "Leave your email and we'll send you the answer if you close this window."}
            </p>
            <div className="mt-3 grid gap-2">
              {config.requireName || missingContactFields.includes("name") || contactDraft.name ? (
                <input
                  type="text"
                  aria-label="Your name"
                  value={contactDraft.name}
                  onChange={(event) => setContactDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Your name"
                  autoComplete="name"
                  className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                />
              ) : null}
              <input
                type="email"
                aria-label="Your email"
                value={contactDraft.email}
                onChange={(event) => setContactDraft((current) => ({ ...current, email: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveContact();
                  }
                }}
                placeholder="you@example.com"
                autoComplete="email"
                className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
              />
              {config.requirePhone ? (
                <input
                  type="tel"
                  aria-label="Your phone number"
                  value={contactDraft.phone}
                  onChange={(event) => setContactDraft((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="+92 300 1234567"
                  autoComplete="tel"
                  className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                />
              ) : null}
            </div>
            {contactError ? <p className="mt-2 text-xs text-red-600">{contactError}</p> : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={saveContact}
                className="h-9 rounded-full px-4 text-sm font-medium text-white"
                style={{ backgroundColor: config.primaryColor }}
              >
                Submit
              </button>
              {missingContactFields.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setContactDismissed(true)}
                  className="h-9 rounded-full px-4 text-sm text-slate-500 hover:bg-slate-100"
                >
                  Not now
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
      </main>

      <footer className="shrink-0 border-t border-slate-200 bg-white px-4 pb-3 pt-3">
        {conversationEnded ? (
          <p className="mb-2 rounded-2xl bg-slate-50 px-4 py-2.5 text-center text-xs text-slate-500">
            This conversation has ended. Send a message to start a new one — we&apos;ll remember what
            we talked about.
          </p>
        ) : null}

        {showExpiryWarning && session ? (
          <p className="mb-2 rounded-2xl bg-amber-50 px-4 py-2 text-center text-xs text-amber-700">
            This conversation closes after {formatMinutes(session.idleTimeoutMinutes)} without messages
            — about {Math.max(1, Math.ceil((expiresInMs ?? 0) / 60000))} min left.
          </p>
        ) : null}

        {error ? (
          <p className="mb-2 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {pendingAttachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingAttachments.map((attachment) => (
              <span
                key={attachment.url}
                className="flex max-w-full items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700"
              >
                <span className="truncate">📎 {attachment.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() =>
                    setPendingAttachments((current) => current.filter((item) => item.url !== attachment.url))
                  }
                  className="text-slate-400 hover:text-slate-700"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <input
            ref={messageInputRef}
            type="text"
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            disabled={inputDisabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage(draft);
              }
            }}
            aria-label="Type your message"
            placeholder={
              !config.isActive
                ? "Chat is paused"
                : missingContactFields.length > 0
                  ? "Add your details above to start"
                  : leadPrompt
                    ? leadPrompt.form.allowSkip
                      ? "Fill in the form above or skip it"
                      : "Fill in the form above to continue"
                  : isListening
                    ? "Listening…"
                    : conversationEnded
                      ? "Start a new conversation…"
                      : "Send a message…"
            }
            className="h-12 min-w-0 flex-1 rounded-full border border-slate-200 px-5 text-sm outline-none transition focus:border-slate-400 disabled:bg-slate-50"
          />
          <button
            type="button"
            aria-label="Send message"
            disabled={
              isSending ||
              isUploading ||
              inputDisabled ||
              coolingDown ||
              (!draft.trim() && pendingAttachments.length === 0)
            }
            title={coolingDown ? "Please wait a moment before sending again" : undefined}
            onClick={() => void sendMessage(draft)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-lg transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: config.primaryColor }}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m5 12 14-7-4 14-3-4-4-3Z" />
            </svg>
          </button>
        </div>

        <div className="relative mt-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,.docx"
              onChange={(event) => void handleFileSelected(event.target.files?.[0])}
            />
            <button
              type="button"
              className={iconButtonClass}
              aria-label="Attach file"
              title="Attach an image or document (max 5 MB)"
              disabled={inputDisabled || isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="m8 12 5.5-5.5a3 3 0 1 1 4.2 4.2L9.5 19a5 5 0 1 1-7.1-7.1l8.2-8.2" />
                </svg>
              )}
            </button>
            {speechSupported ? (
              <button
                type="button"
                className={`${iconButtonClass} ${isListening ? "bg-red-50 text-red-500" : ""}`}
                aria-label={isListening ? "Stop voice typing" : "Voice typing"}
                aria-pressed={isListening}
                title="Speak your message"
                disabled={inputDisabled}
                onClick={toggleDictation}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 4a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0v-5A2.5 2.5 0 0 1 12 4Z" />
                  <path d="M7 11.5a5 5 0 0 0 10 0" />
                  <path d="M12 16.5V20" />
                </svg>
              </button>
            ) : null}
            <button
              type="button"
              className={iconButtonClass}
              aria-label="Insert emoji"
              aria-expanded={emojiOpen}
              disabled={inputDisabled}
              onClick={() => setEmojiOpen((current) => !current)}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="8" />
                <path d="M9 10h.01M15 10h.01" />
                <path d="M8.5 14.5c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5" />
              </svg>
            </button>
          </div>

          <p className="text-xs text-slate-400">
            Powered by <span className="font-semibold text-slate-600">AssistDesk AI</span>
          </p>

          {emojiOpen ? (
            <div
              className="absolute bottom-11 left-0 grid w-[272px] grid-cols-8 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
              role="dialog"
              aria-label="Emoji picker"
            >
              {emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Insert ${emoji}`}
                  onClick={() => {
                    setDraft((current) => `${current}${emoji}`.slice(0, MAX_MESSAGE_LENGTH));
                    setEmojiOpen(false);
                    messageInputRef.current?.focus();
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-slate-100"
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
