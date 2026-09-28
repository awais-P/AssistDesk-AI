"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DashboardPageHeader } from "./dashboard-page-header";

type IntegrationType = "EMAIL" | "WHATSAPP" | "SLACK" | "VOICE";
type IntegrationStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
type ChannelType = "EMAIL" | "SLACK" | "WHATSAPP";

type IntegrationItem = {
  id: string;
  type: IntegrationType;
  name: string;
  provider: string;
  status: IntegrationStatus;
  statusMessage: string | null;
  externalId: string | null;
  supportAddress: string | null;
  forwardingAddress: string | null;
  webhookSecret: string | null;
  config: Record<string, unknown>;
  isActive: boolean;
  lastSyncedAt: string | null;
  inboxId: string | null;
  agentId: string | null;
  inbox: { id: string; name: string; emailPrefix: string } | null;
  agent: { id: string; name: string; status: string } | null;
  createdAt: string;
};

type InboxesOption = {
  id: string;
  name: string;
  emailPrefix: string;
};

type AgentOption = {
  id: string;
  name: string;
  status: string;
};

type ChatbotItem = {
  id: string;
  name: string;
  isActive: boolean;
  widgetId: string;
};

type IntegrationsWorkspaceProps = {
  initialIntegrations: IntegrationItem[];
  inboxes: InboxesOption[];
  agents: AgentOption[];
  initialChatbots: ChatbotItem[];
};

type FormState = {
  id: string;
  type: ChannelType;
  name: string;
  provider: string;
  supportAddress: string;
  forwardingAddress: string;
  inboxId: string;
  agentId: string;
  autoCreateTickets: boolean;
  syncReplies: boolean;
  botToken: string;
  signingSecret: string;
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
};

type Notice = { tone: "success" | "error"; text: string } | null;

const channelLabels: Record<IntegrationType, string> = {
  EMAIL: "Email",
  SLACK: "Slack",
  WHATSAPP: "WhatsApp",
  VOICE: "Voice",
};

const defaultNames: Record<ChannelType, string> = {
  EMAIL: "Primary Email Integration",
  SLACK: "Slack Workspace",
  WHATSAPP: "WhatsApp Business",
};

const emptyForm: FormState = {
  id: "",
  type: "EMAIL",
  name: defaultNames.EMAIL,
  provider: "Forwarded Inbox",
  supportAddress: "",
  forwardingAddress: "",
  inboxId: "",
  agentId: "",
  autoCreateTickets: true,
  syncReplies: true,
  botToken: "",
  signingSecret: "",
  accessToken: "",
  phoneNumberId: "",
  appSecret: "",
};

const inputClassName =
  "w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none transition focus:border-white";
const secondaryButtonClassName =
  "pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-60";
const primaryButtonClassName =
  "pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400";
// Shared by the header and every row so the channel table columns line up.
const rowGridClassName =
  "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_6rem_minmax(0,1.4fr)]";
const emailInboundPath = "/api/integrations/email/inbound";

function statusBadge(status: IntegrationStatus) {
  if (status === "CONNECTED") {
    return "rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-200";
  }

  if (status === "CONNECTING") {
    return "rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-200";
  }

  if (status === "ERROR") {
    return "rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-200";
  }

  return "rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-300";
}

function configText(config: Record<string, unknown>, key: string) {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

function integrationDetail(integration: IntegrationItem) {
  if (integration.type === "SLACK") {
    return configText(integration.config, "teamName") || "Slack workspace";
  }

  if (integration.type === "WHATSAPP") {
    return (
      [
        configText(integration.config, "displayPhoneNumber") ||
          configText(integration.config, "phoneNumberId"),
        configText(integration.config, "verifiedName"),
      ]
        .filter(Boolean)
        .join(" · ") || "WhatsApp number"
    );
  }

  return integration.supportAddress || integration.provider;
}

function formatLastActivity(value: string | null, mounted: boolean) {
  if (!value) {
    return "No activity yet";
  }

  // Dates are formatted after mount so server and browser time zones cannot disagree.
  if (!mounted) {
    return "—";
  }

  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function isPublicOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function ChannelIcon({ type }: { type: IntegrationType | "WEB" }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  let icon: ReactNode;

  if (type === "WEB") {
    icon = (
      <svg {...common}>
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
      </svg>
    );
  } else if (type === "EMAIL") {
    icon = (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
    );
  } else if (type === "SLACK") {
    icon = (
      <svg {...common}>
        <path d="M9 3v8M15 13v8M3 15h8M13 9h8" />
        <circle cx="9" cy="15" r="1.5" />
        <circle cx="15" cy="9" r="1.5" />
      </svg>
    );
  } else if (type === "WHATSAPP") {
    icon = (
      <svg {...common}>
        <path d="M20 11.5a8.5 8.5 0 0 1-12.4 7.5L3 20l1.1-4.4A8.5 8.5 0 1 1 20 11.5Z" />
        <path d="M9 8.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1a3 3 0 0 1-2-2l1-1-1-2Z" />
      </svg>
    );
  } else {
    icon = (
      <svg {...common}>
        <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
      </svg>
    );
  }

  return (
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#111111] text-white">
      {icon}
    </span>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`pressable relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? "border-emerald-400/40 bg-emerald-500/70"
          : "border-white/10 bg-[#1a1a1a]"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white transition ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function CopyField({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#111111] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <div className="mt-2 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all text-xs leading-5 text-white">
          {value || "Loading…"}
        </code>
        <button
          type="button"
          disabled={!value}
          onClick={onCopy}
          aria-label={`Copy ${label}`}
          className="pressable shrink-0 rounded-lg border border-white/10 bg-[#151515] px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-[#1c1c1c] disabled:opacity-60"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-white/10 px-1.5 py-0.5 text-[0.75rem] text-white">
      {children}
    </code>
  );
}

function SetupGuide({ type }: { type: "SLACK" | "WHATSAPP" }) {
  const steps =
    type === "SLACK"
      ? [
          <>
            Go to <Code>api.slack.com/apps</Code> → <strong>Create New App</strong> →{" "}
            <strong>From scratch</strong>.
          </>,
          <>
            <strong>OAuth &amp; Permissions</strong> → Bot Token Scopes: add{" "}
            <Code>chat:write</Code>, <Code>im:history</Code>,{" "}
            <Code>app_mentions:read</Code> (optional <Code>users:read</Code> to
            show names).
          </>,
          <>
            <strong>Install to Workspace</strong> and copy the Bot User OAuth
            Token (starts with <Code>xoxb-</Code>).
          </>,
          <>
            <strong>Basic Information</strong> → copy the <strong>Signing Secret</strong>.
          </>,
          <>Paste both here and Save — AssistDesk tests the token right away.</>,
          <>
            After saving, open <strong>Event Subscriptions</strong> → Enable →
            paste the <strong>Request URL</strong> shown below → Subscribe to bot
            events <Code>message.im</Code> and <Code>app_mention</Code> → Save.
          </>,
          <>
            <strong>App Home</strong> → enable &quot;Allow users to send Slash
            commands and messages from the messages tab&quot;. Then DM the app or
            @mention it in a channel.
          </>,
        ]
      : [
          <>
            Go to <Code>developers.facebook.com</Code> → <strong>My Apps</strong> →{" "}
            <strong>Create App</strong> (type Business) → add the{" "}
            <strong>WhatsApp</strong> product.
          </>,
          <>
            <strong>WhatsApp → API Setup</strong>: copy the Phone number ID and
            an access token (the temporary 24h token for testing, or a System
            User permanent token).
          </>,
          <>
            <strong>App settings → Basic</strong> → copy the <strong>App Secret</strong>.
          </>,
          <>Paste them here and Save — AssistDesk tests the number right away.</>,
          <>
            <strong>WhatsApp → Configuration → Webhook → Edit</strong>: paste the{" "}
            <strong>Callback URL</strong> and <strong>Verify token</strong> shown
            below → Verify and save → Manage → subscribe to the{" "}
            <Code>messages</Code> field.
          </>,
          <>
            In <strong>API Setup</strong>, add your phone as a test recipient and
            send a message to the test number.
          </>,
        ];

  return (
    <details className="group rounded-xl border border-white/10 bg-[#101010]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-white">
        Step-by-step setup guide
        <span className="text-xs text-slate-500 transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="border-t border-white/10 px-4 py-4">
        <ol className="list-decimal space-y-2.5 pl-5 text-sm leading-6 text-slate-400 marker:text-slate-500">
          {steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
        <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-xs leading-5 text-amber-100">
          The webhook URL must be public HTTPS. For local testing run a tunnel
          such as <Code>ngrok http 3000</Code> and open AssistDesk through the
          tunnel URL so the URLs shown here are public.
        </p>
      </div>
    </details>
  );
}

export function IntegrationsWorkspace({
  initialIntegrations,
  inboxes,
  agents,
  initialChatbots,
}: IntegrationsWorkspaceProps) {
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [chatbots, setChatbots] = useState(initialChatbots);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [notice, setNotice] = useState<Notice>(null);
  const [drawerNotice, setDrawerNotice] = useState<Notice>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [togglingId, setTogglingId] = useState("");
  const [isTogglingWidget, setIsTogglingWidget] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSaving) {
        setDrawerOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen, isSaving]);

  const mounted = origin !== "";
  const editingIntegration = useMemo(
    () => integrations.find((item) => item.id === form.id) ?? null,
    [integrations, form.id],
  );
  const activeChatbotCount = chatbots.filter((chatbot) => chatbot.isActive).length;

  function hasStoredSecret(key: string) {
    return Boolean(editingIntegration && configText(editingIntegration.config, key));
  }

  function webhookUrls(integrationId: string) {
    if (!origin) {
      return { slack: "", whatsapp: "" };
    }

    return {
      slack: `${origin}/api/integrations/slack/events/${integrationId}`,
      whatsapp: `${origin}/api/integrations/whatsapp/webhook/${integrationId}`,
    };
  }

  async function handleCopy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? "" : current));
      }, 2000);
    } catch {
      const message = "Unable to copy. Select the text and copy it manually.";
      if (drawerOpen) {
        setDrawerNotice({ tone: "error", text: message });
      } else {
        setNotice({ tone: "error", text: message });
      }
    }
  }

  function openDrawer(type: ChannelType, integration?: IntegrationItem) {
    if (integration) {
      setForm({
        ...emptyForm,
        id: integration.id,
        type,
        name: integration.name,
        provider: integration.provider,
        supportAddress: integration.supportAddress || "",
        forwardingAddress: integration.forwardingAddress || "",
        inboxId: integration.inboxId || "",
        agentId: integration.agentId || "",
        autoCreateTickets: integration.config.autoCreateTickets !== false,
        syncReplies: integration.config.syncReplies !== false,
        phoneNumberId: configText(integration.config, "phoneNumberId"),
      });
    } else {
      setForm({
        ...emptyForm,
        type,
        name: defaultNames[type],
        provider: type === "EMAIL" ? emptyForm.provider : "",
        inboxId: type === "EMAIL" ? inboxes[0]?.id || "" : "",
        agentId: agents[0]?.id || "",
      });
    }

    setNotice(null);
    setDrawerNotice(
      integration?.status === "ERROR" && integration.statusMessage
        ? { tone: "error", text: integration.statusMessage }
        : null,
    );
    setDrawerOpen(true);
  }

  function closeDrawer() {
    if (isSaving) {
      return;
    }

    setDrawerOpen(false);
    setDrawerNotice(null);
  }

  function validateForm() {
    if (!form.name.trim()) {
      return "Give this connection a name so you can recognise it later.";
    }

    if (form.type === "EMAIL") {
      return form.supportAddress.trim()
        ? ""
        : "Enter the support address customers email, like support@yourcompany.com.";
    }

    if (!form.agentId) {
      return agents.length === 0
        ? "Create an AI agent first (AI Agents → New Agent), then come back to connect this channel."
        : "Choose the AI agent that should answer this channel.";
    }

    if (form.type === "SLACK") {
      if (!form.botToken.trim() && !hasStoredSecret("botToken")) {
        return "Paste the Bot User OAuth Token from Slack → OAuth & Permissions.";
      }

      if (form.botToken.trim() && !form.botToken.trim().startsWith("xoxb-")) {
        return "The Bot User OAuth Token starts with xoxb-. Copy it from Slack → OAuth & Permissions (not the user or app-level token).";
      }

      if (!form.signingSecret.trim() && !hasStoredSecret("signingSecret")) {
        return "Paste the Signing Secret from Slack → Basic Information → App Credentials.";
      }

      return "";
    }

    if (!form.phoneNumberId.trim()) {
      return "Paste the Phone number ID from Meta → WhatsApp → API Setup.";
    }

    if (!form.accessToken.trim() && !hasStoredSecret("accessToken")) {
      return "Paste an access token from Meta → WhatsApp → API Setup.";
    }

    if (!form.appSecret.trim() && !hasStoredSecret("appSecret")) {
      return "Paste the App Secret from Meta → App settings → Basic.";
    }

    return "";
  }

  function buildPayload() {
    const base = {
      id: form.id || undefined,
      type: form.type,
      name: form.name.trim(),
      agentId: form.agentId || null,
      isActive: editingIntegration?.isActive ?? true,
    };

    if (form.type === "EMAIL") {
      return {
        ...base,
        provider: form.provider,
        supportAddress: form.supportAddress,
        forwardingAddress: form.forwardingAddress || null,
        inboxId: form.inboxId || null,
        config: {
          autoCreateTickets: form.autoCreateTickets,
          syncReplies: form.syncReplies,
        },
      };
    }

    // Blank secrets are sent as empty strings; the server keeps the stored value.
    return {
      ...base,
      config:
        form.type === "SLACK"
          ? { botToken: form.botToken.trim(), signingSecret: form.signingSecret.trim() }
          : {
              accessToken: form.accessToken.trim(),
              phoneNumberId: form.phoneNumberId.trim(),
              appSecret: form.appSecret.trim(),
            },
    };
  }

  async function handleSave() {
    setDrawerNotice(null);

    const validationError = validateForm();

    if (validationError) {
      setDrawerNotice({ tone: "error", text: validationError });
      return;
    }

    const isNew = !form.id;
    setIsSaving(true);

    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildPayload()),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        integration?: IntegrationItem;
      };

      if (!response.ok || !data.integration) {
        setDrawerNotice({
          tone: "error",
          text:
            data.error ??
            `Unable to save the ${channelLabels[form.type]} connection. Check the fields and try again.`,
        });
        return;
      }

      const saved = data.integration;

      setIntegrations((current) => {
        const existingIndex = current.findIndex((item) => item.id === saved.id);

        if (existingIndex >= 0) {
          const next = [...current];
          next[existingIndex] = saved;
          return next;
        }

        return [...current, saved];
      });

      // Secrets are stored now; clear them so they do not linger in the browser.
      setForm((current) => ({
        ...current,
        id: saved.id,
        botToken: "",
        signingSecret: "",
        accessToken: "",
        appSecret: "",
        phoneNumberId: configText(saved.config, "phoneNumberId") || current.phoneNumberId,
      }));

      if (saved.status === "ERROR") {
        setDrawerNotice({
          tone: "error",
          text: `Saved, but the connection test failed: ${
            saved.statusMessage ?? "unknown error"
          } Fix the fields above and save again.`,
        });
        return;
      }

      const message = saved.statusMessage ?? "Connection saved.";

      if (isNew && saved.type !== "EMAIL") {
        // Keep the drawer open: the webhook URL the user must paste next is shown here.
        setDrawerNotice({
          tone: "success",
          text:
            saved.type === "SLACK"
              ? `${message} Next: copy the Request URL below into Slack → Event Subscriptions.`
              : `${message} Next: copy the Callback URL and Verify token below into Meta → WhatsApp → Configuration.`,
        });
        return;
      }

      setDrawerOpen(false);
      setDrawerNotice(null);
      setNotice({ tone: "success", text: message });
    } catch {
      setDrawerNotice({
        tone: "error",
        text: "Could not reach AssistDesk. Check your internet connection and try again.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteIntegration(integration: IntegrationItem) {
    const shouldDelete = window.confirm(
      `Delete "${integration.name}"? Messages from this ${channelLabels[integration.type]} channel will stop reaching AssistDesk. This cannot be undone.`,
    );

    if (!shouldDelete) {
      return;
    }

    setDeletingId(integration.id);
    setNotice(null);

    try {
      const response = await fetch(`/api/integrations/${integration.id}`, {
        method: "DELETE",
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setNotice({
          tone: "error",
          text: data.error ?? "Unable to delete this integration. Refresh the page and try again.",
        });
        return;
      }

      setIntegrations((current) => current.filter((item) => item.id !== integration.id));
      setNotice({ tone: "success", text: `${integration.name} was deleted.` });
    } catch {
      setNotice({
        tone: "error",
        text: "Could not reach AssistDesk. Check your internet connection and try again.",
      });
    } finally {
      setDeletingId("");
    }
  }

  async function handleToggleIntegration(integration: IntegrationItem, isActive: boolean) {
    setTogglingId(integration.id);
    setNotice(null);

    try {
      const response = await fetch(`/api/integrations/${integration.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isActive }),
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setNotice({
          tone: "error",
          text: data.error ?? "Unable to change this channel. Refresh the page and try again.",
        });
        return;
      }

      setIntegrations((current) =>
        current.map((item) => (item.id === integration.id ? { ...item, isActive } : item)),
      );
      setNotice({
        tone: "success",
        text: isActive
          ? `${integration.name} is enabled.`
          : `${integration.name} is paused. Incoming messages are ignored until you enable it again.`,
      });
    } catch {
      setNotice({
        tone: "error",
        text: "Could not reach AssistDesk. Check your internet connection and try again.",
      });
    } finally {
      setTogglingId("");
    }
  }

  async function handleToggleWidget(isActive: boolean) {
    setIsTogglingWidget(true);
    setNotice(null);

    const results = await Promise.all(
      chatbots.map(async (chatbot) => {
        try {
          const response = await fetch(`/api/chatbots/${chatbot.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ isActive }),
          });

          return { id: chatbot.id, ok: response.ok };
        } catch {
          return { id: chatbot.id, ok: false };
        }
      }),
    );

    const updatedIds = new Set(results.filter((result) => result.ok).map((result) => result.id));
    const failedCount = results.length - updatedIds.size;

    setChatbots((current) =>
      current.map((chatbot) =>
        updatedIds.has(chatbot.id) ? { ...chatbot, isActive } : chatbot,
      ),
    );

    setNotice(
      failedCount > 0
        ? {
            tone: "error",
            text: `${failedCount} chatbot${failedCount === 1 ? "" : "s"} could not be updated. Try again, or change them individually under Chatbots.`,
          }
        : {
            tone: "success",
            text: isActive
              ? "Web chat widgets are live on your websites."
              : "Web chat widgets are paused and hidden from visitors.",
          },
    );
    setIsTogglingWidget(false);
  }

  const drawerUrls = form.id ? webhookUrls(form.id) : null;
  const drawerTitle = `${form.id ? "Edit" : "Connect"} ${channelLabels[form.type]}`;
  const savedPlaceholder = "Saved — leave blank to keep";

  return (
    <div className="px-5 py-4 md:px-6">
      <DashboardPageHeader title="Integrations" />

      <p className="mt-3 max-w-3xl text-sm text-slate-400">
        Connect the channels your customers already use. Messages from each
        channel reach the AI agent you choose, and conversations appear in your
        AssistDesk dashboard.
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => openDrawer("EMAIL")}
          className={primaryButtonClassName}
        >
          Connect Email
        </button>
        <button
          type="button"
          onClick={() => openDrawer("SLACK")}
          className={secondaryButtonClassName}
        >
          Connect Slack
        </button>
        <button
          type="button"
          onClick={() => openDrawer("WHATSAPP")}
          className={secondaryButtonClassName}
        >
          Connect WhatsApp
        </button>
      </div>

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
        </p>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a]">
        <div className={`hidden gap-4 ${rowGridClassName} border-b border-white/10 px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 lg:grid`}>
          <span>Channel</span>
          <span>Status</span>
          <span>AI Agent</span>
          <span>Last Activity</span>
          <span>Enabled</span>
          <span className="text-right">Actions</span>
        </div>

        <ul className="divide-y divide-white/10">
          <li className={`grid gap-4 px-5 py-4 ${rowGridClassName} lg:items-center`}>
            <div className="flex min-w-0 items-center gap-3">
              <ChannelIcon type="WEB" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">Web Chat Widget</p>
                <p className="truncate text-xs text-slate-400">
                  Built-in ·{" "}
                  {chatbots.length === 0
                    ? "no chatbots yet"
                    : `${activeChatbotCount} of ${chatbots.length} chatbot${
                        chatbots.length === 1 ? "" : "s"
                      } active`}
                </p>
              </div>
            </div>
            <div>
              {chatbots.length > 0 ? (
                <span className={statusBadge("CONNECTED")}>Connected</span>
              ) : (
                <span className={statusBadge("DISCONNECTED")}>Not configured</span>
              )}
            </div>
            <p className="text-sm text-slate-400">Set per chatbot</p>
            <p className="text-sm text-slate-400">—</p>
            <div>
              {chatbots.length > 0 ? (
                <ToggleSwitch
                  checked={activeChatbotCount > 0}
                  disabled={isTogglingWidget}
                  label="Enable web chat widgets"
                  onChange={(next) => void handleToggleWidget(next)}
                />
              ) : (
                <span className="text-sm text-slate-500">—</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Link
                href="/dashboard/chatbots"
                className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#1a1a1a]"
              >
                {chatbots.length > 0 ? "Manage chatbots" : "Create chatbot"}
              </Link>
            </div>
          </li>

          {integrations.length === 0 ? (
            <li className="px-5 py-6 text-sm text-slate-400">
              No Email, Slack or WhatsApp channels are connected yet. Use the
              buttons above to connect one.
            </li>
          ) : null}

          {integrations.map((integration) => {
            const urls = webhookUrls(integration.id);
            const channelType = integration.type === "VOICE" ? null : integration.type;

            return (
              <li key={integration.id} className="px-5 py-4">
                <div className={`grid gap-4 ${rowGridClassName} lg:items-center`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <ChannelIcon type={integration.type} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {integration.name}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {channelLabels[integration.type]} · {integrationDetail(integration)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <span
                      className={statusBadge(integration.status)}
                      title={integration.statusMessage ?? undefined}
                    >
                      {integration.status.toLowerCase()}
                    </span>
                  </div>
                  <p className="truncate text-sm text-slate-300">
                    {integration.agent?.name ?? (
                      <span className="text-slate-500">No agent linked</span>
                    )}
                  </p>
                  <p className="text-sm text-slate-400">
                    {formatLastActivity(integration.lastSyncedAt, mounted)}
                  </p>
                  <div>
                    <ToggleSwitch
                      checked={integration.isActive}
                      disabled={togglingId === integration.id}
                      label={`Enable ${integration.name}`}
                      onChange={(next) => void handleToggleIntegration(integration, next)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {channelType ? (
                      <button
                        type="button"
                        onClick={() => openDrawer(channelType, integration)}
                        className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#1a1a1a]"
                      >
                        Edit
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={deletingId === integration.id}
                      onClick={() => void handleDeleteIntegration(integration)}
                      className="pressable inline-flex items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/15 disabled:opacity-60"
                    >
                      {deletingId === integration.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>

                {integration.status === "ERROR" && integration.statusMessage ? (
                  <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs leading-5 text-red-200">
                    {integration.statusMessage} Click Edit to update the
                    credentials and test again.
                  </p>
                ) : null}

                {integration.type !== "VOICE" ? (
                  <details className="mt-3 group">
                    <summary className="cursor-pointer list-none text-xs font-medium text-slate-400 transition hover:text-white">
                      <span className="inline-block transition group-open:rotate-90">›</span>{" "}
                      Connection details
                    </summary>
                    <div className="mt-3 grid gap-3 xl:grid-cols-2">
                      {integration.type === "SLACK" ? (
                        <CopyField
                          label="Request URL"
                          value={urls.slack}
                          copied={copiedKey === `${integration.id}-slack`}
                          onCopy={() => void handleCopy(`${integration.id}-slack`, urls.slack)}
                        />
                      ) : null}
                      {integration.type === "WHATSAPP" ? (
                        <>
                          <CopyField
                            label="Callback URL"
                            value={urls.whatsapp}
                            copied={copiedKey === `${integration.id}-whatsapp`}
                            onCopy={() =>
                              void handleCopy(`${integration.id}-whatsapp`, urls.whatsapp)
                            }
                          />
                          <CopyField
                            label="Verify token"
                            value={integration.webhookSecret ?? ""}
                            copied={copiedKey === `${integration.id}-verify`}
                            onCopy={() =>
                              void handleCopy(
                                `${integration.id}-verify`,
                                integration.webhookSecret ?? "",
                              )
                            }
                          />
                        </>
                      ) : null}
                      {integration.type === "EMAIL" ? (
                        <>
                          <CopyField
                            label="Inbound Endpoint"
                            value={emailInboundPath}
                            copied={copiedKey === `${integration.id}-email`}
                            onCopy={() =>
                              void handleCopy(`${integration.id}-email`, emailInboundPath)
                            }
                          />
                          {integration.webhookSecret ? (
                            <CopyField
                              label="Webhook Secret"
                              value={integration.webhookSecret}
                              copied={copiedKey === `${integration.id}-secret`}
                              onCopy={() =>
                                void handleCopy(
                                  `${integration.id}-secret`,
                                  integration.webhookSecret ?? "",
                                )
                              }
                            />
                          ) : null}
                          <p className="text-xs leading-5 text-slate-400 xl:col-span-2">
                            Use this endpoint for provider forwarding or
                            webhook-based ingestion. Match the connected email
                            using the webhook secret, support address (
                            {integration.supportAddress || "not configured"}),
                            or forwarding address (
                            {integration.forwardingAddress || "not configured"}).
                            Inbox: {integration.inbox?.name ?? "none linked"}.
                          </p>
                        </>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}

          <li
            aria-disabled="true"
            className={`grid gap-4 px-5 py-4 opacity-60 ${rowGridClassName} lg:items-center`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <ChannelIcon type="VOICE" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">Voice Calls</p>
                <p className="truncate text-xs text-slate-400">
                  Real-time voice intake and transcription
                </p>
              </div>
            </div>
            <div>
              <span className={statusBadge("DISCONNECTED")}>Coming soon</span>
            </div>
            <p className="text-sm text-slate-500">—</p>
            <p className="text-sm text-slate-500">—</p>
            <span className="text-sm text-slate-500">—</span>
            <div className="flex lg:justify-end">
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-semibold text-slate-500"
              >
                Coming Soon
              </button>
            </div>
          </li>
        </ul>
      </section>

      <div
        className={`fixed inset-0 z-50 transition ${
          drawerOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
      >
        <button
          type="button"
          aria-label="Close drawer"
          onClick={closeDrawer}
          className={`absolute inset-0 bg-black/60 transition duration-300 ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
        />

        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="integration-drawer-title"
          className={`absolute right-0 top-0 flex h-full max-h-dvh w-full max-w-[520px] flex-col border-l border-white/10 bg-[#090909] shadow-[-16px_0_40px_rgba(0,0,0,0.45)] transition duration-300 ${
            drawerOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
            <div className="flex items-start gap-3">
              <ChannelIcon type={form.type} />
              <div>
                <p id="integration-drawer-title" className="text-xl font-semibold text-white">
                  {drawerTitle}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {form.type === "EMAIL"
                    ? "Link a support email so incoming emails create tickets automatically."
                    : form.type === "SLACK"
                      ? "Let your AI agent answer DMs and @mentions in your Slack workspace."
                      : "Let your AI agent answer customers on your WhatsApp Business number."}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={closeDrawer}
              disabled={isSaving}
              className="pressable rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-[#1a1a1a] disabled:opacity-60"
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="space-y-4">
              {form.type !== "EMAIL" ? <SetupGuide type={form.type} /> : null}

              <div>
                <label
                  htmlFor="integration-name"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Connection Name
                </label>
                <input
                  id="integration-name"
                  type="text"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  className={inputClassName}
                />
              </div>

              {form.type === "EMAIL" ? (
                <>
                  <div>
                    <label
                      htmlFor="integration-provider"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Provider
                    </label>
                    <select
                      id="integration-provider"
                      value={form.provider}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          provider: event.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none"
                    >
                      {["Forwarded Inbox", "Gmail", "Outlook", "Custom SMTP"].map(
                        (provider) => (
                          <option key={provider} value={provider}>
                            {provider}
                          </option>
                        ),
                      )}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="integration-support-address"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Support Address
                    </label>
                    <input
                      id="integration-support-address"
                      type="email"
                      value={form.supportAddress}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          supportAddress: event.target.value,
                        }))
                      }
                      placeholder="support@yourcompany.com"
                      className={inputClassName}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="integration-forwarding-address"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Forwarding Address
                    </label>
                    <input
                      id="integration-forwarding-address"
                      type="email"
                      value={form.forwardingAddress}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          forwardingAddress: event.target.value,
                        }))
                      }
                      placeholder="forward-to@assistdesk.local"
                      className={inputClassName}
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      This can be the address you forward provider emails into for
                      ticket creation.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label
                        htmlFor="integration-inbox"
                        className="mb-2 block text-sm font-medium text-slate-300"
                      >
                        Inbox
                      </label>
                      <select
                        id="integration-inbox"
                        value={form.inboxId}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            inboxId: event.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none"
                      >
                        <option value="">No Inbox</option>
                        {inboxes.map((inbox) => (
                          <option key={inbox.id} value={inbox.id}>
                            {inbox.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="integration-agent"
                        className="mb-2 block text-sm font-medium text-slate-300"
                      >
                        AI Agent
                      </label>
                      <select
                        id="integration-agent"
                        value={form.agentId}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            agentId: event.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none"
                      >
                        <option value="">No Agent</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-white/10 bg-[#101010] px-4 py-4">
                    <label className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-white">
                        Auto-create tickets from emails
                      </span>
                      <input
                        type="checkbox"
                        checked={form.autoCreateTickets}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            autoCreateTickets: event.target.checked,
                          }))
                        }
                        className="h-4 w-4 accent-white"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-white">
                        Sync outgoing replies later
                      </span>
                      <input
                        type="checkbox"
                        checked={form.syncReplies}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            syncReplies: event.target.checked,
                          }))
                        }
                        className="h-4 w-4 accent-white"
                      />
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label
                      htmlFor="integration-agent"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      AI Agent <span className="text-red-300">*</span>
                    </label>
                    <select
                      id="integration-agent"
                      required
                      value={form.agentId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          agentId: event.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none"
                    >
                      <option value="">Choose an agent</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                          {agent.status !== "ACTIVE" ? ` (${agent.status.toLowerCase()})` : ""}
                        </option>
                      ))}
                    </select>
                    {agents.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-400">
                        You have no AI agents yet.{" "}
                        <Link
                          href="/dashboard/ai-agents"
                          className="font-medium text-white underline underline-offset-2"
                        >
                          Create one first
                        </Link>
                        .
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        This agent answers every message that arrives on this channel.
                      </p>
                    )}
                  </div>

                  {form.type === "SLACK" ? (
                    <>
                      <div>
                        <label
                          htmlFor="integration-bot-token"
                          className="mb-2 block text-sm font-medium text-slate-300"
                        >
                          Bot User OAuth Token
                        </label>
                        <input
                          id="integration-bot-token"
                          type="password"
                          autoComplete="off"
                          value={form.botToken}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, botToken: event.target.value }))
                          }
                          placeholder={hasStoredSecret("botToken") ? savedPlaceholder : "xoxb-..."}
                          className={inputClassName}
                        />
                        {hasStoredSecret("botToken") && editingIntegration ? (
                          <p className="mt-2 text-xs text-slate-500">
                            Stored: {configText(editingIntegration.config, "botToken")}
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <label
                          htmlFor="integration-signing-secret"
                          className="mb-2 block text-sm font-medium text-slate-300"
                        >
                          Signing Secret
                        </label>
                        <input
                          id="integration-signing-secret"
                          type="password"
                          autoComplete="off"
                          value={form.signingSecret}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              signingSecret: event.target.value,
                            }))
                          }
                          placeholder={
                            hasStoredSecret("signingSecret")
                              ? savedPlaceholder
                              : "From Basic Information → App Credentials"
                          }
                          className={inputClassName}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label
                          htmlFor="integration-phone-number-id"
                          className="mb-2 block text-sm font-medium text-slate-300"
                        >
                          Phone Number ID
                        </label>
                        <input
                          id="integration-phone-number-id"
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          value={form.phoneNumberId}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              phoneNumberId: event.target.value,
                            }))
                          }
                          placeholder="e.g. 123456789012345"
                          className={inputClassName}
                        />
                        <p className="mt-2 text-xs text-slate-500">
                          The numeric ID from API Setup, not the phone number itself.
                        </p>
                      </div>

                      <div>
                        <label
                          htmlFor="integration-access-token"
                          className="mb-2 block text-sm font-medium text-slate-300"
                        >
                          Access Token
                        </label>
                        <input
                          id="integration-access-token"
                          type="password"
                          autoComplete="off"
                          value={form.accessToken}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              accessToken: event.target.value,
                            }))
                          }
                          placeholder={
                            hasStoredSecret("accessToken") ? savedPlaceholder : "EAAG..."
                          }
                          className={inputClassName}
                        />
                        {hasStoredSecret("accessToken") && editingIntegration ? (
                          <p className="mt-2 text-xs text-slate-500">
                            Stored: {configText(editingIntegration.config, "accessToken")}.
                            Temporary tokens expire after 24 hours.
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <label
                          htmlFor="integration-app-secret"
                          className="mb-2 block text-sm font-medium text-slate-300"
                        >
                          App Secret
                        </label>
                        <input
                          id="integration-app-secret"
                          type="password"
                          autoComplete="off"
                          value={form.appSecret}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, appSecret: event.target.value }))
                          }
                          placeholder={
                            hasStoredSecret("appSecret")
                              ? savedPlaceholder
                              : "From App settings → Basic"
                          }
                          className={inputClassName}
                        />
                      </div>
                    </>
                  )}

                  <div className="space-y-3 rounded-xl border border-white/10 bg-[#101010] p-4">
                    <p className="text-sm font-semibold text-white">
                      {form.type === "SLACK" ? "Event Subscriptions" : "Webhook"}
                    </p>
                    {drawerUrls ? (
                      form.type === "SLACK" ? (
                        <CopyField
                          label="Request URL"
                          value={drawerUrls.slack}
                          copied={copiedKey === "drawer-slack"}
                          onCopy={() => void handleCopy("drawer-slack", drawerUrls.slack)}
                        />
                      ) : (
                        <>
                          <CopyField
                            label="Callback URL"
                            value={drawerUrls.whatsapp}
                            copied={copiedKey === "drawer-whatsapp"}
                            onCopy={() =>
                              void handleCopy("drawer-whatsapp", drawerUrls.whatsapp)
                            }
                          />
                          <CopyField
                            label="Verify token"
                            value={editingIntegration?.webhookSecret ?? ""}
                            copied={copiedKey === "drawer-verify"}
                            onCopy={() =>
                              void handleCopy(
                                "drawer-verify",
                                editingIntegration?.webhookSecret ?? "",
                              )
                            }
                          />
                        </>
                      )
                    ) : (
                      <p className="text-xs leading-5 text-slate-400">
                        Save first — the{" "}
                        {form.type === "SLACK"
                          ? "Request URL"
                          : "Callback URL and Verify token"}{" "}
                        you paste into {form.type === "SLACK" ? "Slack" : "Meta"} will
                        appear here.
                      </p>
                    )}
                    {mounted && !isPublicOrigin(origin) ? (
                      <p className="text-xs leading-5 text-amber-200">
                        You are on {origin}, which{" "}
                        {form.type === "SLACK" ? "Slack" : "Meta"} cannot reach. Run a
                        tunnel such as <Code>ngrok http 3000</Code> and open
                        AssistDesk through the tunnel URL.
                      </p>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="shrink-0 space-y-3 border-t border-white/10 px-5 py-4">
            {drawerNotice ? (
              <p
                role={drawerNotice.tone === "error" ? "alert" : "status"}
                className={`max-h-32 overflow-y-auto rounded-xl border px-4 py-3 text-sm ${
                  drawerNotice.tone === "error"
                    ? "border-red-500/30 bg-red-500/10 text-red-200"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                }`}
              >
                {drawerNotice.text}
              </p>
            ) : null}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={closeDrawer}
                disabled={isSaving}
                className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-60"
              >
                {form.id ? "Done" : "Cancel"}
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleSave()}
                className={primaryButtonClassName}
              >
                {isSaving
                  ? form.type === "EMAIL"
                    ? "Saving..."
                    : "Testing connection…"
                  : form.id
                    ? "Save Changes"
                    : `Connect ${channelLabels[form.type]}`}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
