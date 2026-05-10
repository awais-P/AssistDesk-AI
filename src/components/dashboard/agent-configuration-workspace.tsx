"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  agentProviderOptions,
  defaultAgentSystemPrompt,
  formatAgentRuntimeLabel,
  formatAgentShortId,
  getDefaultModelForProvider,
  getModelsForProvider,
  usesCustomApiKey,
} from "@/src/lib/agent-config";

type AgentDetail = {
  id: string;
  name: string;
  provider: string;
  model: string;
  apiKey: string | null;
  systemPrompt: string | null;
  temperature: number;
  confidenceThreshold: number;
  status: string;
};

type KnowledgeSourceItem = {
  id: string;
  title: string;
  type: "FILE" | "URL" | "TEXT";
  status: string;
  sourceUrl: string | null;
  fileName: string | null;
  rawText: string | null;
  lastSyncedAt: string | null;
};

type AgentConfigurationWorkspaceProps = {
  initialAgent: AgentDetail;
  initialSources: KnowledgeSourceItem[];
  initialAutomations: Array<{
    id: string;
    key: string;
    title: string;
    description: string;
    triggerType: "INCOMING" | "SCHEDULED";
    summary: string | null;
    isEnabled: boolean;
  }>;
  initialTab?: AgentTabKey;
};

type AgentTabKey =
  | "overview"
  | "sources"
  | "automations"
  | "playground"
  | "settings";

type PlaygroundMessage = {
  id: string;
  sender: "user" | "assistant";
  content: string;
};

type AutomationItem = {
  id: string;
  key: string;
  title: string;
  description: string;
  badge: "incoming" | "scheduled";
  detail: string;
  enabled: boolean;
};

const tabItems: Array<{ key: AgentTabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "sources", label: "Sources" },
  { key: "automations", label: "Automations" },
  { key: "playground", label: "Playground" },
  { key: "settings", label: "Settings" },
];

const documentationLinks = [
  {
    title: "How to train an AI agent for customer support",
    action: "sources" as const,
  },
  {
    title: "How to automate ticket responses with AI",
    action: "automations" as const,
  },
  {
    title: "Embed AI chatbot on your website",
    action: "chatbots" as const,
  },
];

function buildSourceTitle(type: "TEXT" | "URL", value: string) {
  if (type === "URL") {
    try {
      const parsedUrl = new URL(value);
      return parsedUrl.hostname + parsedUrl.pathname;
    } catch {
      return value;
    }
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Text source";
  }

  if (normalized.length <= 38) {
    return normalized;
  }

  return `${normalized.slice(0, 38)}...`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not synced yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatDecimal(value: number) {
  return value.toFixed(1);
}

function AgentTabIcon({ tab }: { tab: AgentTabKey }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    className: "h-4 w-4",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
  } as const;

  if (tab === "sources") {
    return (
      <svg {...commonProps}>
        <path d="M5 5h14v14H5z" />
        <path d="M9 5v14" />
      </svg>
    );
  }

  if (tab === "automations") {
    return (
      <svg {...commonProps}>
        <path d="m13 3-4 7h4l-2 11 7-10h-4l2-8Z" />
      </svg>
    );
  }

  if (tab === "playground") {
    return (
      <svg {...commonProps}>
        <path d="M5 6h14v10H8l-3 3z" />
      </svg>
    );
  }

  if (tab === "settings") {
    return (
      <svg {...commonProps}>
        <path d="M4 7h8" />
        <path d="M16 7h4" />
        <path d="M10 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" />
        <path d="M4 17h4" />
        <path d="M12 17h8" />
        <path d="M8 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <rect x="5" y="5" width="6" height="6" />
      <rect x="13" y="5" width="6" height="6" />
      <rect x="5" y="13" width="6" height="6" />
      <rect x="13" y="13" width="6" height="6" />
    </svg>
  );
}

function SourceTypeCard({
  active,
  title,
  description,
  onClick,
  icon,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${
        active
          ? "border-white bg-[#111111]"
          : "border-white/10 bg-[#090909] hover:border-white/20"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/8 text-white">
          {icon}
        </div>
        <div>
          <p className="text-lg font-semibold text-white">{title}</p>
          <p className="mt-1 text-sm text-slate-400">{description}</p>
        </div>
      </div>
    </button>
  );
}

export function AgentConfigurationWorkspace({
  initialAgent,
  initialSources,
  initialAutomations,
  initialTab = "overview",
}: AgentConfigurationWorkspaceProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AgentTabKey>(initialTab);
  const [agent, setAgent] = useState({
    ...initialAgent,
    systemPrompt: initialAgent.systemPrompt || defaultAgentSystemPrompt,
  });
  const [settings, setSettings] = useState({
    name: initialAgent.name,
    provider: initialAgent.provider,
    model: initialAgent.model,
    apiKey: initialAgent.apiKey || "",
    confidenceThreshold: initialAgent.confidenceThreshold,
    temperature: initialAgent.temperature,
    systemPrompt: initialAgent.systemPrompt || defaultAgentSystemPrompt,
  });
  const [sources, setSources] = useState(initialSources);
  const [sourceMenuId, setSourceMenuId] = useState("");
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [sourceModalTab, setSourceModalTab] = useState<"add" | "test">("add");
  const [sourceType, setSourceType] = useState<"TEXT" | "URL">("TEXT");
  const [textContent, setTextContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [testFeedback, setTestFeedback] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSubmittingSource, setIsSubmittingSource] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [sourceSuccess, setSourceSuccess] = useState("");
  const [playgroundInput, setPlaygroundInput] = useState("");
  const [playgroundMessages, setPlaygroundMessages] = useState<PlaygroundMessage[]>([]);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [automationItems, setAutomationItems] = useState<AutomationItem[]>(
    initialAutomations.map((automation) => ({
      id: automation.id,
      key: automation.key,
      title: automation.title,
      description: automation.description,
      badge: automation.triggerType === "SCHEDULED" ? "scheduled" : "incoming",
      detail: automation.summary || "",
      enabled: automation.isEnabled,
    })),
  );
  const [automationMessage, setAutomationMessage] = useState("");
  const [automationError, setAutomationError] = useState("");
  const [automationDrawerItem, setAutomationDrawerItem] =
    useState<AutomationItem | null>(null);
  const [automationDraftDetail, setAutomationDraftDetail] = useState("");
  const [isSavingAutomation, setIsSavingAutomation] = useState(false);
  const availableSettingsModels = useMemo(
    () => getModelsForProvider(settings.provider),
    [settings.provider],
  );

  useEffect(() => {
    function handleWindowClick() {
      setSourceMenuId("");
    }

    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  const trainedSourcesCount = useMemo(() => {
    return sources.filter((source) => source.status === "SYNCED").length;
  }, [sources]);

  function changeTab(nextTab: AgentTabKey) {
    setActiveTab(nextTab);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("tab", nextTab);
    window.history.replaceState({}, "", nextUrl.toString());
  }

  function resetSourceModal() {
    setSourceModalOpen(false);
    setSourceModalTab("add");
    setSourceType("TEXT");
    setTextContent("");
    setSourceUrl("");
    setTestUrl("");
    setTestFeedback("");
    setSourceError("");
  }

  async function handleAddSource() {
    setSourceError("");
    setSourceSuccess("");
    setIsSubmittingSource(true);

    try {
      if (sourceModalTab === "test") {
        try {
          const parsedUrl = new URL(testUrl);
          setTestFeedback(
            `URL looks valid and ready to crawl from ${parsedUrl.hostname}.`,
          );
        } catch {
          setSourceError("Enter a valid URL before running a test.");
        }

        setIsSubmittingSource(false);
        return;
      }

      const payload =
        sourceType === "TEXT"
          ? {
              title: buildSourceTitle("TEXT", textContent),
              type: "TEXT",
              rawText: textContent,
              agentId: agent.id,
            }
          : {
              title: buildSourceTitle("URL", sourceUrl),
              type: "URL",
              sourceUrl,
              agentId: agent.id,
            };

      const response = await fetch("/api/knowledge-sources", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as {
        error?: string;
        knowledgeSource?: KnowledgeSourceItem;
      };

      if (!response.ok || !data.knowledgeSource) {
        setSourceError(data.error ?? "Unable to add the knowledge source.");
        setIsSubmittingSource(false);
        return;
      }

      setSources((current) => [data.knowledgeSource as KnowledgeSourceItem, ...current]);
      setSourceSuccess("Knowledge source added successfully.");
      resetSourceModal();
    } catch {
      setSourceError("Something went wrong while adding the source.");
    } finally {
      setIsSubmittingSource(false);
    }
  }

  async function handleDeleteSource(sourceId: string) {
    const shouldDelete = window.confirm(
      "Delete this knowledge source from the agent?",
    );

    if (!shouldDelete) {
      return;
    }

    setSourceMenuId("");

    try {
      const response = await fetch(`/api/knowledge-sources/${sourceId}`, {
        method: "DELETE",
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setSourceError(data.error ?? "Unable to delete the source right now.");
        return;
      }

      setSources((current) => current.filter((source) => source.id !== sourceId));
    } catch {
      setSourceError("Something went wrong while deleting the source.");
    }
  }

  async function handleSaveSettings() {
    setSettingsError("");
    setSettingsMessage("");
    setIsSavingSettings(true);

    try {
      const response = await fetch("/api/ai-agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: agent.id,
          name: settings.name,
          provider: settings.provider,
          model: settings.model,
          apiKey: usesCustomApiKey(settings.provider) ? settings.apiKey : null,
          confidenceThreshold: settings.confidenceThreshold,
          temperature: settings.temperature,
          systemPrompt: settings.systemPrompt,
          status: agent.status,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        agent?: {
          id: string;
          name: string;
          provider: string;
          model: string;
          apiKey: string | null;
          systemPrompt: string | null;
          temperature: number;
          confidenceThreshold: number;
          status: string;
        };
      };

      if (!response.ok || !data.agent) {
        setSettingsError(data.error ?? "Unable to save settings.");
        setIsSavingSettings(false);
        return;
      }

      const nextAgent = {
        ...agent,
        name: data.agent.name,
        provider: data.agent.provider,
        model: data.agent.model,
        apiKey: data.agent.apiKey,
        systemPrompt: data.agent.systemPrompt || defaultAgentSystemPrompt,
        temperature: data.agent.temperature,
        confidenceThreshold: data.agent.confidenceThreshold,
        status: data.agent.status,
      };

      setAgent(nextAgent);
      setSettings({
        name: nextAgent.name,
        provider: nextAgent.provider,
        model: nextAgent.model,
        apiKey: nextAgent.apiKey || "",
        confidenceThreshold: nextAgent.confidenceThreshold,
        temperature: nextAgent.temperature,
        systemPrompt: nextAgent.systemPrompt,
      });
      setSettingsMessage("Agent settings saved successfully.");
    } catch {
      setSettingsError("Something went wrong while saving settings.");
    } finally {
      setIsSavingSettings(false);
    }
  }

  function handleResetSettings() {
      setSettings({
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        apiKey: agent.apiKey || "",
        confidenceThreshold: agent.confidenceThreshold,
        temperature: agent.temperature,
        systemPrompt: agent.systemPrompt,
    });
    setSettingsError("");
    setSettingsMessage("");
  }

  async function handleSendPlaygroundMessage() {
    const trimmedInput = playgroundInput.trim();

    if (!trimmedInput) {
      return;
    }

    const userMessage: PlaygroundMessage = {
      id: `${Date.now()}-user`,
      sender: "user",
      content: trimmedInput,
    };

    setPlaygroundMessages((current) => [...current, userMessage]);
    setPlaygroundInput("");
    setIsSendingMessage(true);

    try {
      const response = await fetch(`/api/ai-agents/${agent.id}/playground`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmedInput,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        reply?: string;
      };

      const agentReply: PlaygroundMessage = {
        id: `${Date.now()}-assistant`,
        sender: "assistant",
        content:
          response.ok && data.reply
            ? data.reply
            : data.error ?? "Unable to test the agent right now.",
      };

      setPlaygroundMessages((current) => [...current, agentReply]);
    } catch {
      setPlaygroundMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-assistant`,
          sender: "assistant",
          content: "Something went wrong while testing the agent.",
        },
      ]);
    } finally {
      setIsSendingMessage(false);
    }
  }

  function handleConfigureAutomation(item: AutomationItem) {
    setAutomationError("");
    setAutomationMessage("");
    setAutomationDrawerItem(item);
    setAutomationDraftDetail(item.detail);
  }

  async function persistAutomationUpdate(
    automationId: string,
    values: {
      isEnabled?: boolean;
      summary?: string;
    },
  ) {
    const response = await fetch(`/api/ai-agents/${agent.id}/automations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: automationId,
        ...values,
      }),
    });

    const data = (await response.json()) as {
      error?: string;
      automation?: {
        id: string;
        summary: string | null;
        isEnabled: boolean;
      };
    };

    if (!response.ok || !data.automation) {
      throw new Error(data.error ?? "Unable to update automation.");
    }

    const updatedAutomation = data.automation;

    setAutomationItems((current) =>
      current.map((entry) =>
        entry.id === automationId
          ? {
              ...entry,
              enabled: updatedAutomation.isEnabled,
              detail: updatedAutomation.summary || "",
            }
          : entry,
      ),
    );
  }

  async function handleToggleAutomation(item: AutomationItem) {
    setAutomationError("");
    setAutomationMessage("");

    try {
      await persistAutomationUpdate(item.id, {
        isEnabled: !item.enabled,
      });

      setAutomationMessage(
        `${item.title} ${item.enabled ? "disabled" : "enabled"} successfully.`,
      );
    } catch (error) {
      setAutomationError(
        error instanceof Error ? error.message : "Unable to update automation.",
      );
    }
  }

  async function handleSaveAutomationDetail() {
    if (!automationDrawerItem) {
      return;
    }

    setAutomationError("");
    setAutomationMessage("");
    setIsSavingAutomation(true);

    try {
      await persistAutomationUpdate(automationDrawerItem.id, {
        summary: automationDraftDetail,
      });

      setAutomationMessage(
        `${automationDrawerItem.title} configuration saved successfully.`,
      );
      setAutomationDrawerItem(null);
    } catch (error) {
      setAutomationError(
        error instanceof Error ? error.message : "Unable to save automation.",
      );
    } finally {
      setIsSavingAutomation(false);
    }
  }

  const renderOverview = (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <AgentTabIcon tab="sources" />
            <span>Knowledge Sources</span>
          </div>
          <div className="mt-9">
            <div className="flex items-end gap-2">
              <span className="text-4xl font-semibold text-white">
                {sources.length}
              </span>
              <span className="pb-1 text-lg text-slate-500">/ 10</span>
            </div>
            <p className="mt-4 text-sm text-slate-400">
              {trainedSourcesCount} trained
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <AgentTabIcon tab="playground" />
            <span>Messages Used</span>
          </div>
          <div className="mt-9">
            <div className="flex items-end gap-2">
              <span className="text-4xl font-semibold text-white">0</span>
              <span className="pb-1 text-lg text-slate-500">/ 100</span>
            </div>
            <div className="mt-4 h-2 rounded-full bg-white/10">
              <div className="h-2 w-0 rounded-full bg-white" />
            </div>
            <p className="mt-3 text-sm text-slate-400">100 remaining</p>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <AgentTabIcon tab="settings" />
            <span>Agent Configuration</span>
          </div>
          <div className="mt-9">
            <p className="text-2xl font-semibold text-white">{agent.model}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-lg bg-white/10 px-2.5 py-1 text-sm text-white">
                Temp: {formatDecimal(agent.temperature)}
              </span>
              <span className="rounded-lg bg-white/10 px-2.5 py-1 text-sm text-white">
                Conf: {formatDecimal(agent.confidenceThreshold)}
              </span>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
        <p className="text-2xl font-semibold text-white">Quick Actions</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => changeTab("sources")}
            className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
          >
            Manage Sources
          </button>
          <button
            type="button"
            onClick={() => changeTab("playground")}
            className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
          >
            Test in Playground
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard/chatbots")}
            className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
          >
            Embed Widget
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
        <p className="text-2xl font-semibold text-white">Documentation</p>
        <p className="mt-2 text-sm text-slate-400">
          Learn how to get the most out of your AI agent
        </p>

        <div className="mt-6 space-y-3">
          {documentationLinks.map((item) => (
            <button
              key={item.title}
              type="button"
              onClick={() => {
                if (item.action === "chatbots") {
                  router.push("/dashboard/chatbots");
                  return;
                }

                changeTab(item.action);
              }}
              className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-4 py-4 text-left text-sm text-white transition hover:border-white/10 hover:bg-white/[0.04]"
            >
              <span>{item.title}</span>
              <span className="text-slate-500">Open</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  const renderSources = (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold text-white">
            Knowledge Sources {sources.length} / 10
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSourceModalOpen(true)}
            className="pressable inline-flex h-11 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 text-sm font-semibold text-white transition hover:bg-[#1a1a1a]"
          >
            + Add Source
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard/knowledge-base")}
            className="pressable inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#1a1a1a]"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M7 17 17 7" />
              <path d="M9 7h8v8" />
            </svg>
          </button>
        </div>
      </div>

      {sourceError ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {sourceError}
        </p>
      ) : null}

      {sourceSuccess ? (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {sourceSuccess}
        </p>
      ) : null}

      {sources.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-[#0a0a0a] px-5 py-8 text-sm text-slate-400">
          No sources added yet. Use Add Source to train this agent with text or
          URLs.
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => (
            <article
              key={source.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0a0a0a] px-4 py-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/8 text-white">
                  {source.type === "URL" ? (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M10 14 8 16a3 3 0 1 1-4-4l2-2a3 3 0 0 1 4 0" />
                      <path d="m14 10 2-2a3 3 0 1 1 4 4l-2 2a3 3 0 0 1-4 0" />
                      <path d="m8 16 8-8" />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M7 4h7l4 4v12H7z" />
                      <path d="M14 4v4h4" />
                      <path d="M10 12h4" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-white">
                    {source.fileName || source.title}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {source.sourceUrl || formatDate(source.lastSyncedAt)}
                  </p>
                </div>
              </div>

              <div className="relative flex items-center gap-3">
                <span className="rounded-full border border-white/10 bg-[#111111] px-3 py-1 text-xs font-medium text-slate-200">
                  {source.status === "SYNCED" ? "Trained" : source.status}
                </span>

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSourceMenuId((current) =>
                      current === source.id ? "" : source.id,
                    );
                  }}
                  className="pressable inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#1a1a1a]"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="currentColor"
                  >
                    <circle cx="12" cy="5" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="12" cy="19" r="1.8" />
                  </svg>
                </button>

                {sourceMenuId === source.id ? (
                  <div
                    className="absolute right-0 top-11 z-20 min-w-[140px] rounded-xl border border-white/10 bg-[#0f0f0f] p-1.5 shadow-[0_14px_32px_rgba(0,0,0,0.45)]"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => handleDeleteSource(source.id)}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-200 transition hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="border-t border-white/10 pt-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-2xl font-semibold text-white">Messages Used</p>
            <p className="mt-2 text-sm text-slate-400">100 messages remaining</p>
          </div>
          <p className="text-xl text-slate-400">0 / 100</p>
        </div>
        <div className="mt-4 h-2 rounded-full bg-white/10">
          <div className="h-2 w-0 rounded-full bg-white" />
        </div>
      </section>

      <div
        className={`fixed inset-0 z-50 transition ${
          sourceModalOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <button
          type="button"
          aria-label="Close source modal"
          onClick={resetSourceModal}
          className={`absolute inset-0 bg-black/60 transition duration-300 ${
            sourceModalOpen ? "opacity-100" : "opacity-0"
          }`}
        />

        <div
          className={`absolute left-1/2 top-1/2 w-[min(92vw,880px)] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-white/10 bg-[#080808] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] transition duration-300 ${
            sourceModalOpen ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[2rem] font-semibold text-white">
                Add Knowledge Source
              </h2>
            </div>
            <button
              type="button"
              onClick={resetSourceModal}
              className="pressable rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-sm text-slate-300 transition hover:bg-[#1a1a1a]"
            >
              X
            </button>
          </div>

          <div className="mt-5 grid gap-2 rounded-xl bg-[#121212] p-1 sm:grid-cols-2">
            {(["add", "test"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setSourceModalTab(item);
                  setSourceError("");
                  setTestFeedback("");
                }}
                className={`rounded-lg px-4 py-3 text-sm font-semibold transition ${
                  sourceModalTab === item
                    ? "bg-white text-[#050505]"
                    : "text-slate-300 hover:bg-white/5"
                }`}
              >
                {item === "add" ? "+ Add" : "Test URL"}
              </button>
            ))}
          </div>

          {sourceModalTab === "add" ? (
            <div className="mt-6">
              <p className="text-lg font-semibold text-white">Source Type</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <SourceTypeCard
                  active={sourceType === "TEXT"}
                  title="Text"
                  description="Add plain text content"
                  onClick={() => setSourceType("TEXT")}
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M7 4h7l4 4v12H7z" />
                      <path d="M14 4v4h4" />
                      <path d="M10 12h4" />
                    </svg>
                  }
                />
                <SourceTypeCard
                  active={sourceType === "URL"}
                  title="URL"
                  description="Scrape web pages"
                  onClick={() => setSourceType("URL")}
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M10 14 8 16a3 3 0 1 1-4-4l2-2a3 3 0 0 1 4 0" />
                      <path d="m14 10 2-2a3 3 0 1 1 4 4l-2 2a3 3 0 0 1-4 0" />
                      <path d="m8 16 8-8" />
                    </svg>
                  }
                />
              </div>

              {sourceType === "TEXT" ? (
                <div className="mt-6">
                  <label className="mb-3 block text-sm font-medium text-slate-300">
                    Text Content
                  </label>
                  <textarea
                    value={textContent}
                    onChange={(event) => setTextContent(event.target.value)}
                    placeholder="Paste your text content here..."
                    className="min-h-[230px] w-full rounded-2xl border border-white/10 bg-[#121212] px-4 py-4 text-sm leading-6 text-white outline-none transition focus:border-white"
                  />
                  <p className="mt-3 text-xs text-slate-500">
                    {textContent.length} characters
                  </p>
                </div>
              ) : (
                <div className="mt-6">
                  <label className="mb-3 block text-sm font-medium text-slate-300">
                    Website URL
                  </label>
                  <input
                    type="url"
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    placeholder="https://example.com/docs"
                    className="w-full rounded-2xl border border-white/10 bg-[#121212] px-4 py-4 text-sm text-white outline-none transition focus:border-white"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="mt-6">
              <label className="mb-3 block text-sm font-medium text-slate-300">
                Website URL
              </label>
              <input
                type="url"
                value={testUrl}
                onChange={(event) => setTestUrl(event.target.value)}
                placeholder="https://example.com/help-center"
                className="w-full rounded-2xl border border-white/10 bg-[#121212] px-4 py-4 text-sm text-white outline-none transition focus:border-white"
              />

              <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-[#0c0c0c] px-4 py-5">
                <p className="text-sm text-slate-400">
                  {testFeedback ||
                    "Run a quick test to validate the URL before adding it as a source."}
                </p>
              </div>
            </div>
          )}

          {sourceError ? (
            <p className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {sourceError}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-white/10 pt-5">
            <button
              type="button"
              onClick={resetSourceModal}
              className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSubmittingSource}
              onClick={handleAddSource}
              className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
            >
              {isSubmittingSource
                ? sourceModalTab === "test"
                  ? "Testing..."
                  : "Adding..."
                : sourceModalTab === "test"
                  ? "Run Test"
                  : "Add Source"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAutomations = (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[2rem] font-semibold text-white">Automations</h2>
          <p className="mt-2 text-sm text-slate-400">
            Configure actions that run automatically on incoming or scheduled
            tickets.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/dashboard/knowledge-base")}
          className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
        >
          Docs
        </button>
      </div>

      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4">
        <p className="text-sm font-semibold text-amber-200">Beta Feature</p>
        <p className="mt-1 text-sm text-amber-100/80">
          This feature is currently in Beta. Contact support to request access
          and enable it for your account.
        </p>
      </div>

      {automationMessage ? (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {automationMessage}
        </p>
      ) : null}

      {automationError ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {automationError}
        </p>
      ) : null}

      {automationItems.map((item) => (
        <article
          key={item.id}
          className="rounded-2xl border border-white/10 bg-[#0a0a0a] px-5 py-5"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/6 text-white">
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M8 6h8" />
                  <path d="M6 12h12" />
                  <path d="M9 18h6" />
                </svg>
              </div>
              <div>
                <p className="text-lg font-semibold text-white">{item.title}</p>
                <p className="mt-1 text-sm text-slate-400">{item.description}</p>
                {item.detail ? (
                  <p className="mt-8 text-sm text-slate-500">{item.detail}</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col items-start gap-4 lg:items-end">
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#050505]">
                  {item.badge}
                </span>
                <button
                  type="button"
                  onClick={() => void handleToggleAutomation(item)}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
                    item.enabled ? "bg-white" : "bg-white/10"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-[#050505] transition ${
                      item.enabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleConfigureAutomation(item)}
                className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
              >
                Configure
              </button>
            </div>
          </div>
        </article>
      ))}

      <div
        className={`fixed inset-0 z-50 transition ${
          automationDrawerItem ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <button
          type="button"
          aria-label="Close automation drawer"
          onClick={() => setAutomationDrawerItem(null)}
          className={`absolute inset-0 bg-black/60 transition duration-300 ${
            automationDrawerItem ? "opacity-100" : "opacity-0"
          }`}
        />

        <aside
          className={`absolute right-0 top-0 h-full w-full max-w-[420px] border-l border-white/10 bg-[#090909] shadow-[-16px_0_40px_rgba(0,0,0,0.45)] transition duration-300 ${
            automationDrawerItem ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-xl font-semibold text-white">
                {automationDrawerItem?.title || "Configure Automation"}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                Update the summary or timing note stored for this automation.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAutomationDrawerItem(null)}
              className="pressable rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-[#1a1a1a]"
            >
              Close
            </button>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div className="rounded-xl border border-white/10 bg-[#111111] p-4">
              <p className="text-sm font-medium text-white">
                {automationDrawerItem?.description}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Trigger:{" "}
                {automationDrawerItem?.badge === "scheduled"
                  ? "scheduled"
                  : "incoming"}
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-white">
                Summary / Config Note
              </label>
              <textarea
                value={automationDraftDetail}
                onChange={(event) => setAutomationDraftDetail(event.target.value)}
                placeholder="Example: After 24h of inactivity"
                className="min-h-[160px] w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white"
              />
            </div>

            <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => setAutomationDrawerItem(null)}
                className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingAutomation}
                onClick={() => void handleSaveAutomationDetail()}
                className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
              >
                {isSavingAutomation ? "Saving..." : "Save Configuration"}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );

  const renderPlayground = (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#050505]">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M5 6h14v10H8l-3 3z" />
            </svg>
          </div>
          <div>
            <p className="text-[2rem] font-semibold text-white">{agent.name}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPlaygroundMessages([])}
          className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
        >
          + New Chat
        </button>
      </div>

      <section className="rounded-2xl border border-white/10 bg-[#0a0a0a]">
        <div className="min-h-[520px] px-5 py-5">
          {playgroundMessages.length === 0 ? (
            <div className="flex min-h-[470px] flex-col items-center justify-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-[#111111] text-slate-400">
                <svg
                  viewBox="0 0 24 24"
                  className="h-8 w-8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M5 6h14v10H8l-3 3z" />
                </svg>
              </div>
              <p className="mt-5 text-lg text-slate-400">
                Send a message to start testing your agent
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {playgroundMessages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-3xl rounded-2xl px-4 py-3 text-sm leading-6 ${
                    message.sender === "user"
                      ? "ml-auto bg-white text-[#050505]"
                      : "bg-[#111111] text-slate-100"
                  }`}
                >
                  {message.content}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 px-4 py-4">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={playgroundInput}
              onChange={(event) => setPlaygroundInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSendPlaygroundMessage();
                }
              }}
              placeholder="Ask a question..."
              className="h-14 flex-1 rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none transition focus:border-white"
            />
            <button
              type="button"
              disabled={isSendingMessage}
              onClick={handleSendPlaygroundMessage}
              className="pressable inline-flex h-14 w-14 items-center justify-center rounded-xl bg-white text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M4 12h14" />
                <path d="m12 6 6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      </section>
    </div>
  );

  const renderSettings = (
    <div className="space-y-6">
      <div>
        <label className="mb-2 block text-sm font-medium text-white">
          Agent Name
        </label>
        <input
          type="text"
          value={settings.name}
          onChange={(event) =>
            setSettings((current) => ({ ...current, name: event.target.value }))
          }
          className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-medium text-white">
            Provider
          </label>
          <select
            value={settings.provider}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                provider: event.target.value,
                model: getDefaultModelForProvider(event.target.value),
                apiKey: "",
              }))
            }
            className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none"
          >
            {agentProviderOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-white">
            Model
          </label>
          <select
            value={settings.model}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                model: event.target.value,
              }))
            }
            className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none"
          >
            {availableSettingsModels.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {usesCustomApiKey(settings.provider) ? (
        <div>
          <label className="mb-2 block text-sm font-medium text-white">
            API Key
          </label>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                apiKey: event.target.value,
              }))
            }
            placeholder="Paste your provider API key"
            className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
          />
          <p className="mt-2 text-sm text-slate-400">
            This key is stored for this agent so its Playground and ticket
            automations can call the selected provider.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-[#101010] px-4 py-3 text-sm text-slate-400">
          Default provider models use server-side managed keys configured in
          your environment.
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-white">
            Confidence Threshold
          </label>
          <span className="text-sm text-slate-300">
            {formatDecimal(settings.confidenceThreshold)}
          </span>
        </div>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.1"
          value={settings.confidenceThreshold}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              confidenceThreshold: Number(event.target.value),
            }))
          }
          className="w-full accent-white"
        />
        <p className="mt-2 text-sm text-slate-400">
          Minimum similarity score required to answer a query.
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-white">Temperature</label>
          <span className="text-sm text-slate-300">
            {formatDecimal(settings.temperature)}
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={settings.temperature}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              temperature: Number(event.target.value),
            }))
          }
          className="w-full accent-white"
        />
        <p className="mt-2 text-sm text-slate-400">
          Lower values make responses more focused, higher values make them more
          creative.
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label className="text-sm font-medium text-white">System Prompt</label>
          <span className="text-xs text-slate-500">
            {settings.systemPrompt.length}/8192 characters
          </span>
        </div>
        <textarea
          value={settings.systemPrompt}
          maxLength={8192}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              systemPrompt: event.target.value,
            }))
          }
          className="min-h-[300px] w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-7 text-white outline-none transition focus:border-white"
        />
        <p className="mt-2 text-sm text-slate-400">
          Define the agent&apos;s personality, role, and how it should interact
          with users.
        </p>
      </div>

      {settingsError ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {settingsError}
        </p>
      ) : null}

      {settingsMessage ? (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {settingsMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3 border-t border-white/10 pt-5">
        <button
          type="button"
          disabled={isSavingSettings}
          onClick={handleSaveSettings}
          className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
        >
          {isSavingSettings ? "Saving..." : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={handleResetSettings}
          className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
        >
          Reset
        </button>
      </div>
    </div>
  );

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-6">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/8 text-white">
            <svg
              viewBox="0 0 24 24"
              className="h-7 w-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <rect x="5" y="7" width="14" height="10" rx="2" />
              <path d="M9 7V5h6v2" />
              <path d="M8 12h.01M16 12h.01" />
              <path d="M10 14h4" />
            </svg>
          </div>

          <div>
            <p className="text-[2rem] font-semibold leading-none text-white">
              {agent.name}
            </p>
            <p className="mt-3 text-sm text-slate-400">
              {formatAgentRuntimeLabel(agent.model)} • ID:{" "}
              {formatAgentShortId(agent.id)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => router.push("/dashboard/knowledge-base")}
            className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a1a1a]"
          >
            Docs
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard/chatbots")}
            className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
          >
            Embed
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-2 rounded-2xl bg-[#1a1a1a] p-1 lg:grid-cols-5">
        {tabItems.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => changeTab(tab.key)}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${
              activeTab === tab.key
                ? "bg-[#2b2b2b] text-white"
                : "text-slate-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            <AgentTabIcon tab={tab.key} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-8">
        {activeTab === "overview" ? renderOverview : null}
        {activeTab === "sources" ? renderSources : null}
        {activeTab === "automations" ? renderAutomations : null}
        {activeTab === "playground" ? renderPlayground : null}
        {activeTab === "settings" ? renderSettings : null}
      </div>
    </div>
  );
}
