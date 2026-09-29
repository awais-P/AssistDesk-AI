"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";
import {
  MAX_AGENT_MAX_TOKENS,
  MIN_AGENT_MAX_TOKENS,
  agentProviderOptions,
  agentResponseLengthOptions,
  agentToneOptions,
  defaultAgentSystemPrompt,
  formatAgentRuntimeLabel,
  formatAgentShortId,
  getDefaultModelForProvider,
  getModelsForProvider,
  usesCustomApiKey,
} from "@/src/lib/agent-config";
import {
  MAX_CRAWL_PAGES_UI,
  MAX_KNOWLEDGE_FILE_MB,
  knowledgeFileAcceptAttribute,
  knowledgeFileExtensions,
  knowledgeFileTypesLabel,
} from "@/src/lib/knowledge-file-types";

type AgentDetail = {
  id: string;
  name: string;
  provider: string;
  model: string;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  systemPrompt: string | null;
  temperature: number;
  confidenceThreshold: number;
  maxTokens: number;
  tone: string;
  responseLength: string;
  status: string;
  inboxId: string | null;
};

/** Shape returned by POST /api/ai-agents (the key itself is never included). */
type SavedAgentResponse = AgentDetail & {
  createdAt: string;
  updatedAt: string;
};

type AgentSettingsForm = {
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  confidenceThreshold: number;
  temperature: number;
  maxTokens: number;
  tone: string;
  responseLength: string;
  systemPrompt: string;
};

type KnowledgeSourceItem = {
  id: string;
  title: string;
  type: "FILE" | "URL" | "TEXT";
  status: string;
  sourceUrl: string | null;
  fileName: string | null;
  rawText: string | null;
  pageCount: number;
  processingError: string | null;
  lastSyncedAt: string | null;
};

type SourceModalType = "TEXT" | "URL" | "FILE";

type UrlTestResult = {
  ok: boolean;
  title: string | null;
  characters: number | null;
  message: string;
};
type CrawlMode = "SINGLE" | "CRAWL";

type AgentConfigurationWorkspaceProps = {
  initialAgent: AgentDetail;
  usage: {
    replies: number;
    tokens: number;
  };
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

type PlaygroundReplyMeta = {
  modelUsed: string;
  latencyMs: number;
  usedFallback: boolean;
  fallbackReason: string | null;
};

type PlaygroundMessage = {
  id: string;
  sender: "user" | "assistant";
  content: string;
  /** Set on failed requests; these are shown in red and never sent back as history. */
  isError?: boolean;
  meta?: PlaygroundReplyMeta;
};

type PlaygroundResponse = {
  error?: string;
  reply?: string;
  confidence?: number;
  usedSourceIds?: string[];
  usedFallback?: boolean;
  fallbackReason?: string | null;
  modelUsed?: string;
  latencyMs?: number;
  tokens?: number;
};

const PLAYGROUND_HISTORY_LIMIT = 10;
const DEFAULT_CRAWL_PAGES = 10;

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

function formatAgentStatus(status: string) {
  if (status === "ACTIVE") return "Live";
  if (status === "ARCHIVED") return "Archived";
  return "Draft";
}

function agentStatusPillClass(status: string) {
  if (status === "ACTIVE") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }

  if (status === "ARCHIVED") {
    return "border-white/10 bg-white/5 text-slate-400";
  }

  return "border-amber-500/20 bg-amber-500/10 text-amber-200";
}

function formatSourceStatus(status: string) {
  if (status === "SYNCED") return "Trained";
  if (status === "PROCESSING") return "Processing";
  if (status === "FAILED") return "Failed";
  if (status === "PENDING") return "Queued";
  return status.toLowerCase();
}

function isIndexingStatus(status: string) {
  return status === "PENDING" || status === "PROCESSING";
}

function formatLatency(latencyMs: number) {
  if (latencyMs < 1000) {
    return `${Math.round(latencyMs)} ms`;
  }

  return `${(latencyMs / 1000).toFixed(1)} s`;
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Mirrors the server-side upload rules so users get instant feedback. */
function validateKnowledgeFile(file: File) {
  const dotIndex = file.name.lastIndexOf(".");
  const extension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : "";

  if (!knowledgeFileExtensions.includes(extension)) {
    return `"${file.name}" is not a supported file type. Upload ${knowledgeFileTypesLabel}.`;
  }

  if (file.size === 0) {
    return `"${file.name}" is empty. Choose a file that has content.`;
  }

  if (file.size > MAX_KNOWLEDGE_FILE_MB * 1024 * 1024) {
    return `"${file.name}" is ${formatFileSize(file.size)}. Files must be ${MAX_KNOWLEDGE_FILE_MB} MB or smaller.`;
  }

  return "";
}

function toSourceItem(source: KnowledgeSourceItem): KnowledgeSourceItem {
  return {
    id: source.id,
    title: source.title,
    type: source.type,
    status: source.status,
    sourceUrl: source.sourceUrl,
    fileName: source.fileName,
    rawText: source.rawText,
    pageCount: source.pageCount ?? 0,
    processingError: source.processingError ?? null,
    lastSyncedAt: source.lastSyncedAt,
  };
}

function toSettingsForm(agent: AgentDetail & { systemPrompt: string }): AgentSettingsForm {
  return {
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    // Saved keys never reach the browser; blank means "keep the stored key".
    apiKey: "",
    confidenceThreshold: agent.confidenceThreshold,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    tone: agent.tone,
    responseLength: agent.responseLength,
    systemPrompt: agent.systemPrompt,
  };
}

const playgroundMarkdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-white underline underline-offset-2 transition hover:text-slate-300"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => (
    <p className="mb-2 text-base font-semibold text-white">{children}</p>
  ),
  h2: ({ children }) => (
    <p className="mb-2 text-base font-semibold text-white">{children}</p>
  ),
  h3: ({ children }) => (
    <p className="mb-2 font-semibold text-white">{children}</p>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-white/20 pl-3 text-slate-300 last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-3 text-xs last:mb-0 [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-3 border-white/10" />,
};

function KnowledgeFileDropZone({
  id,
  file,
  disabled,
  onFileSelected,
}: {
  id: string;
  file: File | null;
  disabled?: boolean;
  onFileSelected: (file: File | null) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div>
      <input
        id={id}
        type="file"
        accept={knowledgeFileAcceptAttribute}
        disabled={disabled}
        onChange={(event) => {
          onFileSelected(event.target.files?.[0] ?? null);
          // Allow picking the same file again after a validation error.
          event.target.value = "";
        }}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          ) {
            return;
          }
          setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (!disabled) {
            onFileSelected(event.dataTransfer.files?.[0] ?? null);
          }
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-8 text-center transition peer-focus-visible:border-white ${
          isDragging
            ? "border-white bg-white/[0.06]"
            : "border-white/15 bg-[#121212] hover:border-white/30"
        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M5 20h14" />
        </svg>
        <span className="mt-3 text-sm font-semibold text-white">
          {isDragging ? "Drop the file to upload" : "Drag and drop a file, or click to browse"}
        </span>
        <span className="mt-1 text-xs text-slate-500">
          {knowledgeFileTypesLabel} · up to {MAX_KNOWLEDGE_FILE_MB} MB
        </span>
      </label>

      {file ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium text-white">{file.name}</p>
            <p className="mt-0.5 text-xs text-slate-500">{formatFileSize(file.size)}</p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onFileSelected(null)}
            className="pressable shrink-0 rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-[#262626] disabled:opacity-60"
          >
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
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
  usage: initialUsage,
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
  const [settings, setSettings] = useState<AgentSettingsForm>(() =>
    toSettingsForm({
      ...initialAgent,
      systemPrompt: initialAgent.systemPrompt || defaultAgentSystemPrompt,
    }),
  );
  const [usage, setUsage] = useState(initialUsage);
  const [sources, setSources] = useState(initialSources);
  const [sourceMenuId, setSourceMenuId] = useState("");
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [sourceModalTab, setSourceModalTab] = useState<"add" | "test">("add");
  const [sourceType, setSourceType] = useState<SourceModalType>("TEXT");
  const [textContent, setTextContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [crawlMode, setCrawlMode] = useState<CrawlMode>("SINGLE");
  const [maxPages, setMaxPages] = useState(DEFAULT_CRAWL_PAGES);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [testUrl, setTestUrl] = useState("");
  const [testResult, setTestResult] = useState<UrlTestResult | null>(null);
  const [isTestingUrl, setIsTestingUrl] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSubmittingSource, setIsSubmittingSource] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [sourceSuccess, setSourceSuccess] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusError, setStatusError] = useState("");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [playgroundInput, setPlaygroundInput] = useState("");
  const [playgroundMessages, setPlaygroundMessages] = useState<PlaygroundMessage[]>([]);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  // Guards against a second send before React re-renders with isSendingMessage=true.
  const isSendingRef = useRef(false);
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
  const [togglingAutomationId, setTogglingAutomationId] = useState("");
  const availableSettingsModels = useMemo(
    () => getModelsForProvider(settings.provider),
    [settings.provider],
  );
  const selectedTone =
    agentToneOptions.find((option) => option.value === settings.tone) ??
    agentToneOptions[0];
  const selectedResponseLength =
    agentResponseLengthOptions.find(
      (option) => option.value === settings.responseLength,
    ) ?? agentResponseLengthOptions[1];
  const canKeepSavedKey =
    agent.hasApiKey && settings.provider === agent.provider;

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

  const hasProcessingSources = useMemo(
    () => sources.some((source) => isIndexingStatus(source.status)),
    [sources],
  );

  // URL crawls and file extraction run in the background; poll until they settle.
  useEffect(() => {
    if (!hasProcessingSources) {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch("/api/knowledge-sources", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as {
          knowledgeSources?: Array<KnowledgeSourceItem & { agentId: string | null }>;
        };

        if (!data.knowledgeSources) {
          return;
        }

        setSources(
          data.knowledgeSources
            .filter((source) => source.agentId === agent.id)
            .map(toSourceItem),
        );
      } catch {
        // Keep the current list; the next tick retries.
      }
    }, 4000);

    return () => window.clearInterval(interval);
  }, [agent.id, hasProcessingSources]);

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
    setCrawlMode("SINGLE");
    setMaxPages(DEFAULT_CRAWL_PAGES);
    setSelectedFile(null);
    setTestUrl("");
    setTestResult(null);
    setSourceError("");
  }

  function handleFileSelected(file: File | null) {
    if (!file) {
      setSelectedFile(null);
      return;
    }

    const problem = validateKnowledgeFile(file);

    if (problem) {
      setSelectedFile(null);
      setSourceError(problem);
      return;
    }

    setSourceError("");
    setSelectedFile(file);
  }

  /** Fetches the page server-side (SSRF-safe) to check it has readable text. */
  async function handleTestUrl() {
    if (isTestingUrl) {
      return;
    }

    const url = testUrl.trim();
    setTestResult(null);

    try {
      new URL(url);
    } catch {
      setSourceError("Enter a valid URL (including https://) before running a test.");
      return;
    }

    setIsTestingUrl(true);

    try {
      const response = await fetch("/api/knowledge-sources/test-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        title?: string | null;
        characters?: number;
        message?: string;
      };

      if (!response.ok || typeof data.message !== "string") {
        setSourceError(data.error ?? "Unable to test this URL right now. Try again in a moment.");
        return;
      }

      setTestResult({
        ok: Boolean(data.ok),
        title: data.title ?? null,
        characters: typeof data.characters === "number" ? data.characters : null,
        message: data.message,
      });
    } catch {
      setSourceError("Unable to reach the server to test this URL. Check your connection.");
    } finally {
      setIsTestingUrl(false);
    }
  }

  async function handleAddSource() {
    if (isSubmittingSource) {
      return;
    }

    setSourceError("");
    setSourceSuccess("");

    if (sourceModalTab === "test") {
      await handleTestUrl();
      return;
    }

    if (sourceType === "TEXT" && !textContent.trim()) {
      setSourceError("Paste some text content before adding this source.");
      return;
    }

    if (sourceType === "URL") {
      try {
        new URL(sourceUrl);
      } catch {
        setSourceError("Enter a full website URL, for example https://example.com/docs.");
        return;
      }

      if (
        crawlMode === "CRAWL" &&
        (!Number.isInteger(maxPages) || maxPages < 2 || maxPages > MAX_CRAWL_PAGES_UI)
      ) {
        setSourceError(`Max pages must be a whole number between 2 and ${MAX_CRAWL_PAGES_UI}.`);
        return;
      }
    }

    if (sourceType === "FILE" && !selectedFile) {
      setSourceError("Choose a file to upload first.");
      return;
    }

    setIsSubmittingSource(true);

    try {
      let response: Response;

      if (sourceType === "FILE" && selectedFile) {
        const formData = new FormData();
        formData.set("title", selectedFile.name);
        formData.set("type", "FILE");
        formData.set("agentId", agent.id);
        formData.set("file", selectedFile);

        response = await fetch("/api/knowledge-sources", {
          method: "POST",
          body: formData,
        });
      } else {
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
                crawlMode,
                maxPages: crawlMode === "CRAWL" ? maxPages : 1,
                agentId: agent.id,
              };

        response = await fetch("/api/knowledge-sources", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      }

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        knowledgeSource?: KnowledgeSourceItem;
      };

      if (!response.ok || !data.knowledgeSource) {
        setSourceError(
          data.error ?? "Unable to add the knowledge source. Check the details and try again.",
        );
        return;
      }

      const createdSource = toSourceItem(data.knowledgeSource);

      setSources((current) => [createdSource, ...current]);
      setSourceSuccess(
        isIndexingStatus(createdSource.status)
          ? "Source added and queued for indexing. It will show Trained when ready."
          : "Knowledge source added successfully.",
      );
      resetSourceModal();
    } catch {
      setSourceError(
        "Something went wrong while adding the source. Check your connection and try again.",
      );
    } finally {
      setIsSubmittingSource(false);
    }
  }

  async function handleDeleteSource(sourceId: string) {
    if (deletingSourceId) {
      return;
    }

    const shouldDelete = window.confirm(
      "Delete this knowledge source from the agent?",
    );

    if (!shouldDelete) {
      return;
    }

    setSourceMenuId("");
    setSourceError("");
    setSourceSuccess("");
    setDeletingSourceId(sourceId);

    try {
      const response = await fetch(`/api/knowledge-sources/${sourceId}`, {
        method: "DELETE",
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setSourceError(data.error ?? "Unable to delete the source right now. Try again.");
        return;
      }

      setSources((current) => current.filter((source) => source.id !== sourceId));
      setSourceSuccess("Knowledge source deleted.");
    } catch {
      setSourceError(
        "Something went wrong while deleting the source. Check your connection and try again.",
      );
    } finally {
      setDeletingSourceId("");
    }
  }

  /** Sends the full agent config; the server keeps the stored key when apiKey is omitted. */
  async function saveAgent(values: {
    name: string;
    provider: string;
    model: string;
    apiKey?: string | null;
    confidenceThreshold: number;
    temperature: number;
    maxTokens: number;
    tone: string;
    responseLength: string;
    systemPrompt: string;
    status: string;
  }) {
    const response = await fetch("/api/ai-agents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: agent.id,
        inboxId: agent.inboxId,
        ...values,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      agent?: SavedAgentResponse;
    };

    if (!response.ok || !data.agent) {
      throw new Error(data.error ?? "Unable to save the agent. Try again.");
    }

    const nextAgent = {
      id: data.agent.id,
      name: data.agent.name,
      provider: data.agent.provider,
      model: data.agent.model,
      hasApiKey: data.agent.hasApiKey,
      apiKeyPreview: data.agent.apiKeyPreview,
      systemPrompt: data.agent.systemPrompt || defaultAgentSystemPrompt,
      temperature: data.agent.temperature,
      confidenceThreshold: data.agent.confidenceThreshold,
      maxTokens: data.agent.maxTokens,
      tone: data.agent.tone,
      responseLength: data.agent.responseLength,
      status: data.agent.status,
      inboxId: data.agent.inboxId,
    };

    setAgent(nextAgent);
    return nextAgent;
  }

  async function handleSaveSettings() {
    if (isSavingSettings) {
      return;
    }

    setSettingsError("");
    setSettingsMessage("");

    if (!settings.name.trim()) {
      setSettingsError("Give the agent a name before saving.");
      return;
    }

    const typedKey = settings.apiKey.trim();

    if (usesCustomApiKey(settings.provider) && !typedKey && !canKeepSavedKey) {
      setSettingsError(
        `Paste your ${settings.provider} API key to use this provider, or switch back to Default (Managed).`,
      );
      return;
    }

    if (
      !Number.isFinite(settings.maxTokens) ||
      settings.maxTokens < MIN_AGENT_MAX_TOKENS ||
      settings.maxTokens > MAX_AGENT_MAX_TOKENS
    ) {
      setSettingsError(
        `Max reply tokens must be between ${MIN_AGENT_MAX_TOKENS} and ${MAX_AGENT_MAX_TOKENS}.`,
      );
      return;
    }

    setIsSavingSettings(true);

    try {
      const nextAgent = await saveAgent({
        name: settings.name,
        provider: settings.provider,
        model: settings.model,
        apiKey: usesCustomApiKey(settings.provider) ? typedKey || undefined : null,
        confidenceThreshold: settings.confidenceThreshold,
        temperature: settings.temperature,
        maxTokens: Math.round(settings.maxTokens),
        tone: settings.tone,
        responseLength: settings.responseLength,
        systemPrompt: settings.systemPrompt,
        status: agent.status,
      });

      setSettings(toSettingsForm(nextAgent));
      setSettingsMessage("Agent settings saved successfully.");
    } catch (error) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Something went wrong while saving settings. Try again.",
      );
    } finally {
      setIsSavingSettings(false);
    }
  }

  function handleResetSettings() {
    setSettings(toSettingsForm(agent));
    setSettingsError("");
    setSettingsMessage("");
  }

  async function handleChangeStatus(nextStatus: "ACTIVE" | "DRAFT") {
    if (isUpdatingStatus) {
      return;
    }

    setStatusError("");
    setStatusMessage("");
    setIsUpdatingStatus(true);

    try {
      // Publish the saved configuration; unsaved edits in Settings stay in the form.
      await saveAgent({
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        confidenceThreshold: agent.confidenceThreshold,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        tone: agent.tone,
        responseLength: agent.responseLength,
        systemPrompt: agent.systemPrompt,
        status: nextStatus,
      });

      setStatusMessage(
        nextStatus === "ACTIVE"
          ? "Agent published. It now answers on the chat widget, Slack and WhatsApp."
          : "Agent moved to Draft. Live channels stop using it; the Playground still works.",
      );
    } catch (error) {
      setStatusError(
        error instanceof Error
          ? error.message
          : "Unable to change the agent status. Try again.",
      );
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  async function handleSendPlaygroundMessage() {
    const trimmedInput = playgroundInput.trim();

    if (!trimmedInput || isSendingRef.current) {
      return;
    }

    isSendingRef.current = true;

    const history = playgroundMessages
      .filter((message) => !message.isError)
      .slice(-PLAYGROUND_HISTORY_LIMIT)
      .map((message) => ({
        role: message.sender,
        content: message.content,
      }));

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
          history,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as PlaygroundResponse;

      if (!response.ok || !data.reply) {
        setPlaygroundMessages((current) => [
          ...current,
          {
            id: `${Date.now()}-assistant`,
            sender: "assistant",
            content:
              data.error ??
              "The agent could not reply. Check the provider settings and try again.",
            isError: true,
          },
        ]);
        return;
      }

      const agentReply: PlaygroundMessage = {
        id: `${Date.now()}-assistant`,
        sender: "assistant",
        content: data.reply,
        meta: {
          modelUsed: data.modelUsed ?? agent.model,
          latencyMs: data.latencyMs ?? 0,
          usedFallback: Boolean(data.usedFallback),
          fallbackReason: data.fallbackReason ?? null,
        },
      };

      setPlaygroundMessages((current) => [...current, agentReply]);
      setUsage((current) => ({
        replies: current.replies + 1,
        tokens: current.tokens + (data.tokens ?? 0),
      }));
    } catch {
      setPlaygroundMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-assistant`,
          sender: "assistant",
          content:
            "Something went wrong while testing the agent. Check your connection and try again.",
          isError: true,
        },
      ]);
    } finally {
      isSendingRef.current = false;
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

    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      automation?: {
        id: string;
        summary: string | null;
        isEnabled: boolean;
      };
    };

    if (!response.ok || !data.automation) {
      throw new Error(data.error ?? "Unable to update automation. Try again.");
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
    if (togglingAutomationId) {
      return;
    }

    setAutomationError("");
    setAutomationMessage("");
    setTogglingAutomationId(item.id);

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
    } finally {
      setTogglingAutomationId("");
    }
  }

  async function handleSaveAutomationDetail() {
    if (!automationDrawerItem || isSavingAutomation) {
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
            <span className="text-4xl font-semibold text-white">
              {sources.length}
            </span>
            <p className="mt-4 text-sm text-slate-400">
              {trainedSourcesCount} trained
              {hasProcessingSources ? " • some still processing" : ""}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <AgentTabIcon tab="playground" />
            <span>AI Replies</span>
          </div>
          <div className="mt-9">
            <span className="text-4xl font-semibold text-white">
              {usage.replies.toLocaleString("en-US")}
            </span>
            <p className="mt-4 text-sm text-slate-400">
              {usage.tokens.toLocaleString("en-US")} tokens used across the
              Playground and live channels
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <AgentTabIcon tab="settings" />
            <span>Agent Configuration</span>
          </div>
          <div className="mt-9">
            <p className="text-2xl font-semibold text-white">
              {formatAgentRuntimeLabel(agent.model)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-lg bg-white/10 px-2.5 py-1 text-sm text-white">
                Temp: {formatDecimal(agent.temperature)}
              </span>
              <span className="rounded-lg bg-white/10 px-2.5 py-1 text-sm text-white">
                Conf: {formatDecimal(agent.confidenceThreshold)}
              </span>
              <span className="rounded-lg bg-white/10 px-2.5 py-1 text-sm text-white">
                Tokens: {agent.maxTokens}
              </span>
              <span className="rounded-lg bg-white/10 px-2.5 py-1 text-sm text-white">
                {agentToneOptions.find((option) => option.value === agent.tone)
                  ?.label ?? agent.tone}
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
            Knowledge Sources ({sources.length})
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {trainedSourcesCount} trained
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setSourceSuccess("");
              setSourceError("");
              setSourceModalOpen(true);
            }}
            className="pressable inline-flex h-11 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 text-sm font-semibold text-white transition hover:bg-[#1a1a1a]"
          >
            + Add Source
          </button>
          <button
            type="button"
            aria-label="Open the knowledge base"
            title="Open the knowledge base"
            onClick={() => router.push("/dashboard/knowledge-base")}
            className="pressable inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#1a1a1a]"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M7 17 17 7" />
              <path d="M9 7h8v8" />
            </svg>
          </button>
        </div>
      </div>

      {sourceError && !sourceModalOpen ? (
        <p
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
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
          No sources added yet. Use Add Source to train this agent with text,
          website pages or uploaded files.
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => (
            <article
              key={source.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0a0a0a] px-4 py-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/8 text-white">
                  {source.type === "URL" ? (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
                    >
                      <path d="M10 14 8 16a3 3 0 1 1-4-4l2-2a3 3 0 0 1 4 0" />
                      <path d="m14 10 2-2a3 3 0 1 1 4 4l-2 2a3 3 0 0 1-4 0" />
                      <path d="m8 16 8-8" />
                    </svg>
                  ) : source.type === "FILE" ? (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
                    >
                      <path d="M7 4h7l4 4v12H7z" />
                      <path d="M14 4v4h4" />
                      <path d="M12 11v6" />
                      <path d="m9.5 13.5 2.5-2.5 2.5 2.5" />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
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
                    {source.type === "URL" && source.pageCount > 1
                      ? ` • ${source.pageCount} pages`
                      : ""}
                  </p>
                  {source.status === "FAILED" && source.processingError ? (
                    <p className="mt-1 line-clamp-2 text-xs text-red-200">
                      {source.processingError}
                    </p>
                  ) : null}
                  {source.status === "SYNCED" && source.processingError ? (
                    <p
                      title={source.processingError}
                      className="mt-1 text-xs text-amber-200"
                    >
                      Keyword search only
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="relative flex shrink-0 items-center gap-3">
                <span
                  title={source.processingError ?? undefined}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    source.status === "FAILED"
                      ? "border-red-500/20 bg-red-500/10 text-red-200"
                      : source.status === "PROCESSING"
                        ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
                        : source.status === "SYNCED"
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                          : "border-white/10 bg-[#111111] text-slate-200"
                  }`}
                >
                  {formatSourceStatus(source.status)}
                </span>

                <button
                  type="button"
                  aria-label={`Actions for ${source.fileName || source.title}`}
                  disabled={deletingSourceId === source.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSourceMenuId((current) =>
                      current === source.id ? "" : source.id,
                    );
                  }}
                  className="pressable inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#1a1a1a] disabled:opacity-60"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="currentColor"
                    aria-hidden="true"
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
                      disabled={deletingSourceId === source.id}
                      onClick={() => void handleDeleteSource(source.id)}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-200 transition hover:bg-red-500/10 disabled:opacity-60"
                    >
                      {deletingSourceId === source.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <div
        inert={!sourceModalOpen}
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
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-source-title"
          className={`absolute left-1/2 top-1/2 max-h-[92vh] w-[min(92vw,880px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[28px] border border-white/10 bg-[#080808] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] transition duration-300 ${
            sourceModalOpen ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                id="add-source-title"
                className="text-[2rem] font-semibold text-white"
              >
                Add Knowledge Source
              </h2>
            </div>
            <button
              type="button"
              aria-label="Close"
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
                  setTestResult(null);
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
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <SourceTypeCard
                  active={sourceType === "TEXT"}
                  title="Text"
                  description="Add plain text content"
                  onClick={() => {
                    setSourceType("TEXT");
                    setSourceError("");
                  }}
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
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
                  description="Scrape a page or crawl a site"
                  onClick={() => {
                    setSourceType("URL");
                    setSourceError("");
                  }}
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
                    >
                      <path d="M10 14 8 16a3 3 0 1 1-4-4l2-2a3 3 0 0 1 4 0" />
                      <path d="m14 10 2-2a3 3 0 1 1 4 4l-2 2a3 3 0 0 1-4 0" />
                      <path d="m8 16 8-8" />
                    </svg>
                  }
                />
                <SourceTypeCard
                  active={sourceType === "FILE"}
                  title="File"
                  description="Upload PDF, Word or text files"
                  onClick={() => {
                    setSourceType("FILE");
                    setSourceError("");
                  }}
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
                    >
                      <path d="M7 4h7l4 4v12H7z" />
                      <path d="M14 4v4h4" />
                      <path d="M12 11v6" />
                      <path d="m9.5 13.5 2.5-2.5 2.5 2.5" />
                    </svg>
                  }
                />
              </div>

              {sourceType === "TEXT" ? (
                <div className="mt-6">
                  <label
                    htmlFor="agent-source-text"
                    className="mb-3 block text-sm font-medium text-slate-300"
                  >
                    Text Content
                  </label>
                  <textarea
                    id="agent-source-text"
                    value={textContent}
                    onChange={(event) => setTextContent(event.target.value)}
                    placeholder="Paste your text content here..."
                    className="min-h-[230px] w-full rounded-2xl border border-white/10 bg-[#121212] px-4 py-4 text-sm leading-6 text-white outline-none transition focus:border-white"
                  />
                  <p className="mt-3 text-xs text-slate-500">
                    {textContent.length} characters
                  </p>
                </div>
              ) : null}

              {sourceType === "URL" ? (
                <div className="mt-6 space-y-5">
                  <div>
                    <label
                      htmlFor="agent-source-url"
                      className="mb-3 block text-sm font-medium text-slate-300"
                    >
                      Website URL
                    </label>
                    <input
                      id="agent-source-url"
                      type="url"
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      placeholder="https://example.com/docs"
                      className="w-full rounded-2xl border border-white/10 bg-[#121212] px-4 py-4 text-sm text-white outline-none transition focus:border-white"
                    />
                  </div>

                  <fieldset>
                    <legend className="mb-3 text-sm font-medium text-slate-300">
                      What should we read?
                    </legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(
                        [
                          {
                            value: "SINGLE",
                            label: "Single page",
                            description: "Only the URL above.",
                          },
                          {
                            value: "CRAWL",
                            label: "Crawl website",
                            description: "Follow links on the same site.",
                          },
                        ] as const
                      ).map((option) => (
                        <label
                          key={option.value}
                          className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${
                            crawlMode === option.value
                              ? "border-white bg-[#111111]"
                              : "border-white/10 bg-[#090909] hover:border-white/20"
                          }`}
                        >
                          <input
                            type="radio"
                            name="agent-source-crawl-mode"
                            value={option.value}
                            checked={crawlMode === option.value}
                            onChange={() => setCrawlMode(option.value)}
                            className="mt-1 accent-white"
                          />
                          <span>
                            <span className="block text-sm font-semibold text-white">
                              {option.label}
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-400">
                              {option.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  {crawlMode === "CRAWL" ? (
                    <div>
                      <label
                        htmlFor="agent-source-max-pages"
                        className="mb-3 block text-sm font-medium text-slate-300"
                      >
                        Max pages
                      </label>
                      <input
                        id="agent-source-max-pages"
                        type="number"
                        min={2}
                        max={MAX_CRAWL_PAGES_UI}
                        step={1}
                        value={Number.isFinite(maxPages) ? maxPages : ""}
                        onChange={(event) => setMaxPages(event.target.valueAsNumber)}
                        className="w-full max-w-[200px] rounded-2xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                      />
                      <p className="mt-2 text-xs text-slate-500">
                        Between 2 and {MAX_CRAWL_PAGES_UI}. Crawling runs in the
                        background and can take a minute.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {sourceType === "FILE" ? (
                <div className="mt-6">
                  <p className="mb-3 text-sm font-medium text-slate-300">
                    Upload file
                  </p>
                  <KnowledgeFileDropZone
                    id="agent-source-file"
                    file={selectedFile}
                    disabled={isSubmittingSource}
                    onFileSelected={handleFileSelected}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-6">
              <label
                htmlFor="agent-source-test-url"
                className="mb-3 block text-sm font-medium text-slate-300"
              >
                Website URL
              </label>
              <input
                id="agent-source-test-url"
                type="url"
                value={testUrl}
                onChange={(event) => {
                  setTestUrl(event.target.value);
                  setTestResult(null);
                }}
                placeholder="https://example.com/help-center"
                className="w-full rounded-2xl border border-white/10 bg-[#121212] px-4 py-4 text-sm text-white outline-none transition focus:border-white"
              />

              <div
                role="status"
                className={`mt-5 rounded-2xl border px-4 py-5 ${
                  testResult
                    ? testResult.ok
                      ? "border-emerald-500/20 bg-emerald-500/10"
                      : "border-amber-500/20 bg-amber-500/10"
                    : "border-dashed border-white/10 bg-[#0c0c0c]"
                }`}
              >
                {testResult ? (
                  <>
                    <p
                      className={`text-sm ${
                        testResult.ok ? "text-emerald-100" : "text-amber-100"
                      }`}
                    >
                      {testResult.message}
                    </p>
                    {testResult.title || testResult.characters !== null ? (
                      <p className="mt-2 text-xs text-slate-300">
                        {[
                          testResult.title ? `Page title: ${testResult.title}` : null,
                          testResult.characters !== null
                            ? `${testResult.characters.toLocaleString("en-US")} characters of readable text`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                    {testResult.ok ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSourceType("URL");
                          setSourceUrl(testUrl.trim());
                          setSourceModalTab("add");
                          setTestResult(null);
                        }}
                        className="pressable mt-3 inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#1a1a1a]"
                      >
                        Use this URL as a source
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-slate-400">
                    {isTestingUrl
                      ? "Fetching the page..."
                      : "Run a quick test to check the page is reachable and has readable text before adding it as a source."}
                  </p>
                )}
              </div>
            </div>
          )}

          {sourceError && sourceModalOpen ? (
            <p
              role="alert"
              className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
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
              disabled={isSubmittingSource || isTestingUrl}
              onClick={() => void handleAddSource()}
              className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
            >
              {sourceModalTab === "test"
                ? isTestingUrl
                  ? "Testing..."
                  : "Run Test"
                : isSubmittingSource
                  ? sourceType === "FILE"
                    ? "Uploading..."
                    : "Adding..."
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
          Knowledge Base
        </button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] px-5 py-4">
        <p className="text-sm text-slate-400">
          Automations run on new incoming tickets.
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
                  role="switch"
                  aria-checked={item.enabled}
                  aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.title}`}
                  disabled={togglingAutomationId === item.id}
                  onClick={() => void handleToggleAutomation(item)}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition disabled:opacity-60 ${
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
        inert={!automationDrawerItem}
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
              <label
                htmlFor="automation-config-note"
                className="mb-2 block text-sm font-medium text-white"
              >
                Summary / Config Note
              </label>
              <textarea
                id="automation-config-note"
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
              aria-hidden="true"
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
          disabled={isSendingMessage || playgroundMessages.length === 0}
          onClick={() => setPlaygroundMessages([])}
          className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-50"
        >
          Clear chat
        </button>
      </div>

      {agent.status !== "ACTIVE" ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {agent.status === "ARCHIVED"
            ? "This agent is archived."
            : "This agent is a draft."}{" "}
          You can
          test it here, but it will not answer on the chat widget, Slack or
          WhatsApp until you publish it.
        </p>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-[#0a0a0a]">
        <div className="min-h-[520px] px-5 py-5">
          {playgroundMessages.length === 0 && !isSendingMessage ? (
            <div className="flex min-h-[470px] flex-col items-center justify-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-[#111111] text-slate-400">
                <svg
                  viewBox="0 0 24 24"
                  className="h-8 w-8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M5 6h14v10H8l-3 3z" />
                </svg>
              </div>
              <p className="mt-5 text-lg text-slate-400">
                Send a message to start testing your agent
              </p>
              <p className="mt-2 text-sm text-slate-500">
                The agent remembers the last {PLAYGROUND_HISTORY_LIMIT} messages
                of this chat.
              </p>
            </div>
          ) : (
            <div className="space-y-4" aria-live="polite">
              {playgroundMessages.map((message) =>
                message.sender === "user" ? (
                  <div
                    key={message.id}
                    className="ml-auto max-w-3xl whitespace-pre-wrap rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-[#050505]"
                  >
                    {message.content}
                  </div>
                ) : (
                  <div key={message.id} className="max-w-3xl">
                    {message.isError ? (
                      <div
                        role="alert"
                        className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-200"
                      >
                        {message.content}
                      </div>
                    ) : (
                      <div className="break-words rounded-2xl bg-[#111111] px-4 py-3 text-sm leading-6 text-slate-100">
                        <ReactMarkdown components={playgroundMarkdownComponents}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    )}

                    {message.meta ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-slate-500">
                        <span>{formatAgentRuntimeLabel(message.meta.modelUsed)}</span>
                        <span aria-hidden="true">•</span>
                        <span>{formatLatency(message.meta.latencyMs)}</span>
                        {message.meta.usedFallback ? (
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-200">
                            Knowledge-base fallback — AI provider unavailable
                            {message.meta.fallbackReason
                              ? `: ${message.meta.fallbackReason}`
                              : ""}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ),
              )}

              {isSendingMessage ? (
                <div className="max-w-3xl">
                  <div className="inline-flex rounded-2xl bg-[#111111] px-4 py-3 text-sm text-slate-400">
                    Thinking...
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 px-4 py-4">
          <div className="flex items-center gap-3">
            <label htmlFor="playground-input" className="sr-only">
              Message to test the agent
            </label>
            <input
              id="playground-input"
              type="text"
              value={playgroundInput}
              onChange={(event) => setPlaygroundInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();

                  if (!isSendingMessage) {
                    void handleSendPlaygroundMessage();
                  }
                }
              }}
              placeholder="Ask a question..."
              className="h-14 flex-1 rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none transition focus:border-white"
            />
            <button
              type="button"
              aria-label="Send message"
              disabled={isSendingMessage || !playgroundInput.trim()}
              onClick={() => void handleSendPlaygroundMessage()}
              className="pressable inline-flex h-14 w-14 items-center justify-center rounded-xl bg-white text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
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
        <label
          htmlFor="agent-settings-name"
          className="mb-2 block text-sm font-medium text-white"
        >
          Agent Name
        </label>
        <input
          id="agent-settings-name"
          type="text"
          value={settings.name}
          maxLength={80}
          onChange={(event) =>
            setSettings((current) => ({ ...current, name: event.target.value }))
          }
          className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label
            htmlFor="agent-settings-provider"
            className="mb-2 block text-sm font-medium text-white"
          >
            Provider
          </label>
          <select
            id="agent-settings-provider"
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
          <label
            htmlFor="agent-settings-model"
            className="mb-2 block text-sm font-medium text-white"
          >
            Model
          </label>
          <select
            id="agent-settings-model"
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
          <label
            htmlFor="agent-settings-api-key"
            className="mb-2 block text-sm font-medium text-white"
          >
            API Key
          </label>
          <input
            id="agent-settings-api-key"
            type="password"
            autoComplete="off"
            value={settings.apiKey}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                apiKey: event.target.value,
              }))
            }
            placeholder={
              canKeepSavedKey
                ? `Saved key: ${agent.apiKeyPreview ?? "••••"} — leave blank to keep it`
                : `Paste your ${settings.provider} API key`
            }
            className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
          />
          <p className="mt-2 text-sm text-slate-400">
            {canKeepSavedKey
              ? "A key is already saved for this provider. Paste a new one only if you want to replace it."
              : "Required. The key is stored encrypted for this agent so its Playground and live channels can call the selected provider."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-[#101010] px-4 py-3 text-sm text-slate-400">
          Default provider models use your server-side OpenRouter key and can
          automatically fall through to another managed free model if needed.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <label
            htmlFor="agent-settings-tone"
            className="mb-2 block text-sm font-medium text-white"
          >
            Tone
          </label>
          <select
            id="agent-settings-tone"
            value={settings.tone}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                tone: event.target.value,
              }))
            }
            className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none"
          >
            {agentToneOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm text-slate-400">{selectedTone.instruction}</p>
        </div>

        <div>
          <label
            htmlFor="agent-settings-response-length"
            className="mb-2 block text-sm font-medium text-white"
          >
            Response length
          </label>
          <select
            id="agent-settings-response-length"
            value={settings.responseLength}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                responseLength: event.target.value,
              }))
            }
            className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none"
          >
            {agentResponseLengthOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm text-slate-400">
            {selectedResponseLength.instruction}
          </p>
        </div>

        <div>
          <label
            htmlFor="agent-settings-max-tokens"
            className="mb-2 block text-sm font-medium text-white"
          >
            Max reply tokens
          </label>
          <input
            id="agent-settings-max-tokens"
            type="number"
            min={MIN_AGENT_MAX_TOKENS}
            max={MAX_AGENT_MAX_TOKENS}
            step={1}
            value={Number.isFinite(settings.maxTokens) ? settings.maxTokens : ""}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                maxTokens: event.target.valueAsNumber,
              }))
            }
            className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
          />
          <p className="mt-2 text-sm text-slate-400">
            {MIN_AGENT_MAX_TOKENS}–{MAX_AGENT_MAX_TOKENS} (default 512). Caps
            how long a single reply can be.
          </p>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            htmlFor="agent-settings-confidence"
            className="text-sm font-medium text-white"
          >
            Confidence Threshold
          </label>
          <span className="text-sm text-slate-300">
            {formatDecimal(settings.confidenceThreshold)}
          </span>
        </div>
        <input
          id="agent-settings-confidence"
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
          <label
            htmlFor="agent-settings-temperature"
            className="text-sm font-medium text-white"
          >
            Temperature
          </label>
          <span className="text-sm text-slate-300">
            {formatDecimal(settings.temperature)}
          </span>
        </div>
        <input
          id="agent-settings-temperature"
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
          <label
            htmlFor="agent-settings-system-prompt"
            className="text-sm font-medium text-white"
          >
            System Prompt
          </label>
          <span className="text-xs text-slate-500">
            {settings.systemPrompt.length}/8192 characters
          </span>
        </div>
        <textarea
          id="agent-settings-system-prompt"
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
          with users. Tone and response length above are added automatically.
        </p>
      </div>

      {settingsError ? (
        <p
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
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
          onClick={() => void handleSaveSettings()}
          className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
        >
          {isSavingSettings ? "Saving..." : "Save Changes"}
        </button>
        <button
          type="button"
          disabled={isSavingSettings}
          onClick={handleResetSettings}
          className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-60"
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
              aria-hidden="true"
            >
              <rect x="5" y="7" width="14" height="10" rx="2" />
              <path d="M9 7V5h6v2" />
              <path d="M8 12h.01M16 12h.01" />
              <path d="M10 14h4" />
            </svg>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[2rem] font-semibold leading-none text-white">
                {agent.name}
              </p>
              <span
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${agentStatusPillClass(agent.status)}`}
              >
                {formatAgentStatus(agent.status)}
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-400">
              {formatAgentRuntimeLabel(agent.model)} • ID:{" "}
              {formatAgentShortId(agent.id)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {agent.status === "ACTIVE"
                ? "Live on the chat widget, Slack and WhatsApp."
                : "Not live: only the Playground uses this agent until you publish it."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={isUpdatingStatus}
            onClick={() =>
              void handleChangeStatus(agent.status === "ACTIVE" ? "DRAFT" : "ACTIVE")
            }
            className={`pressable inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${
              agent.status === "ACTIVE"
                ? "border border-white/10 bg-[#111111] text-white hover:bg-[#1a1a1a]"
                : "border border-emerald-500/30 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
            }`}
          >
            {isUpdatingStatus
              ? agent.status === "ACTIVE"
                ? "Unpublishing..."
                : "Publishing..."
              : agent.status === "ACTIVE"
                ? "Unpublish (Draft)"
                : "Publish"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard/knowledge-base")}
            className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a1a1a]"
          >
            Knowledge Base
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

      {statusError ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {statusError}
        </p>
      ) : null}

      {statusMessage ? (
        <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {statusMessage}
        </p>
      ) : null}

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
