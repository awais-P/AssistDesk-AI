"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MAX_CRAWL_PAGES_UI,
  MAX_KNOWLEDGE_FILE_MB,
  knowledgeFileAcceptAttribute,
  knowledgeFileExtensions,
  knowledgeFileTypesLabel,
} from "@/src/lib/knowledge-file-types";

type KnowledgeSourceType = "FILE" | "URL" | "TEXT";
type SyncStatus = "PENDING" | "PROCESSING" | "SYNCED" | "FAILED" | "DELETED";
type CrawlMode = "SINGLE" | "CRAWL";
type SortKey = "NEWEST" | "OLDEST" | "NAME" | "LAST_SYNCED";

const DEFAULT_CRAWL_PAGES = 10;
/** Mirrors LEXICAL_EMBEDDING_MODEL in src/lib/embeddings.ts (server-only module). */
const LEXICAL_EMBEDDING_MODEL = "lexical-hash-v2";

type KnowledgeSourceItem = {
  id: string;
  title: string;
  type: KnowledgeSourceType;
  status: SyncStatus;
  sourceUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  storagePath: string | null;
  fileSize: number | null;
  rawText: string | null;
  crawlMode: string;
  maxPages: number;
  pageCount: number;
  chunkCount: number;
  embeddingModel: string | null;
  vectorStore: string | null;
  vectorIndexedAt: string | null;
  processingError: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  agent?: {
    id: string;
    name: string;
  } | null;
};

type KnowledgeBaseClientProps = {
  initialSources: Array<{
    id: string;
    title: string;
    type: KnowledgeSourceType;
    status: SyncStatus;
    sourceUrl: string | null;
    fileName: string | null;
    mimeType: string | null;
    storagePath: string | null;
    fileSize: number | null;
    rawText: string | null;
    crawlMode: string;
    maxPages: number;
    pageCount: number;
    chunkCount: number;
    embeddingModel: string | null;
    vectorStore: string | null;
    vectorIndexedAt: Date | null;
    processingError: string | null;
    createdAt: Date;
    updatedAt: Date;
    lastSyncedAt: Date | null;
    agent: { id: string; name: string } | null;
  }>;
  /** MANAGER or higher: may add, edit, re-sync, delete and re-index sources. */
  canManage: boolean;
  pineconeConfigured: boolean;
  embeddingModel: string;
};

type UrlTestResult = {
  ok: boolean;
  title: string | null;
  characters: number | null;
  message: string;
};

type RowMenuState = {
  id: string;
  right: number;
  top?: number;
  bottom?: number;
};

const typeOptions: Array<KnowledgeSourceType | "ALL"> = ["ALL", "FILE", "URL", "TEXT"];
const statusOptions: Array<SyncStatus | "ALL"> = [
  "ALL",
  "PENDING",
  "PROCESSING",
  "SYNCED",
  "FAILED",
];
const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: "NEWEST", label: "Newest first" },
  { value: "OLDEST", label: "Oldest first" },
  { value: "NAME", label: "Name (A-Z)" },
  { value: "LAST_SYNCED", label: "Last synced" },
];
const pageSizeOptions = [10, 20, 50];

const statusLabels: Record<SyncStatus, string> = {
  PENDING: "Queued",
  PROCESSING: "Processing",
  SYNCED: "Synced",
  FAILED: "Failed",
  DELETED: "Deleted",
};

const typeLabels: Record<KnowledgeSourceType, string> = {
  FILE: "File",
  URL: "URL",
  TEXT: "Text",
};

function formatDate(value: string | null, timeZone: string | null, withTime = false) {
  if (!value) return null;
  // Rendered only after mount so server and browser markup always match.
  if (!timeZone) return "...";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone,
  }).format(new Date(value));
}

function isIndexing(status: SyncStatus) {
  return status === "PENDING" || status === "PROCESSING";
}

function isSemanticModel(model: string | null) {
  return Boolean(model && model !== LEXICAL_EMBEDDING_MODEL && model.includes(":"));
}

function statusPillClass(status: SyncStatus) {
  if (status === "SYNCED") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }

  if (status === "PROCESSING") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  }

  if (status === "FAILED") {
    return "border-red-500/20 bg-red-500/10 text-red-200";
  }

  if (status === "DELETED") {
    return "border-white/10 bg-white/5 text-slate-400";
  }

  return "border-white/10 bg-[#141414] text-slate-200";
}

function typePillClass(type: KnowledgeSourceType) {
  if (type === "URL") {
    return "border-white/10 bg-[#151515] text-slate-200";
  }

  if (type === "TEXT") {
    return "border-slate-700/60 bg-slate-950 text-slate-100";
  }

  return "border-white/10 bg-[#191919] text-white";
}

/** How the assistant can currently search this source (FE-2). */
function getSearchMode(source: KnowledgeSourceItem) {
  if (source.chunkCount === 0 || !source.embeddingModel) {
    return {
      label: isIndexing(source.status) ? "Indexing..." : "Not indexed",
      className: "text-slate-500",
      hint: "No searchable chunks yet.",
    };
  }

  if (!isSemanticModel(source.embeddingModel)) {
    return {
      label: "Keyword",
      className: "text-amber-200",
      hint: "Offline keyword model: matches words, not meaning. Re-sync once an embedding API key is available.",
    };
  }

  return source.vectorStore === "pinecone"
    ? {
        label: "Semantic · Pinecone",
        className: "text-emerald-200",
        hint: `Embedded with ${source.embeddingModel}, stored in Pinecone.`,
      }
    : {
        label: "Semantic · PostgreSQL",
        className: "text-emerald-200",
        hint: `Embedded with ${source.embeddingModel}, stored in PostgreSQL.`,
      };
}

function trimPreview(value: string | null, length = 120) {
  if (!value) return "";
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function formatFileSize(size: number | null) {
  if (!size) return "No file uploaded";

  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function describeSource(source: KnowledgeSourceItem) {
  if (source.type === "URL") {
    return source.sourceUrl ?? "No URL";
  }

  if (source.type === "FILE") {
    return (
      [source.fileName, formatFileSize(source.fileSize)].filter(Boolean).join(" · ") ||
      "No file metadata"
    );
  }

  return trimPreview(source.rawText, 70) || "No text content";
}

function mapSource(source: KnowledgeBaseClientProps["initialSources"][number]): KnowledgeSourceItem {
  return {
    ...source,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
    lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
    vectorIndexedAt: source.vectorIndexedAt?.toISOString() ?? null,
  };
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
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-7 text-center transition peer-focus-visible:border-white ${
          isDragging
            ? "border-white bg-white/[0.06]"
            : "border-white/15 bg-[#111111] hover:border-white/30"
        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6 text-slate-400"
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
            className="shrink-0 rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-[#262626] disabled:opacity-60"
          >
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function KnowledgeBaseClient({
  initialSources,
  canManage,
  pineconeConfigured,
  embeddingModel,
}: KnowledgeBaseClientProps) {
  const [sources, setSources] = useState<KnowledgeSourceItem[]>(
    initialSources.map(mapSource),
  );
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] =
    useState<(typeof typeOptions)[number]>("ALL");
  const [statusFilter, setStatusFilter] =
    useState<(typeof statusOptions)[number]>("ALL");
  const [agentFilter, setAgentFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("NEWEST");
  const [pageSize, setPageSize] = useState(pageSizeOptions[0]);
  const [page, setPage] = useState(1);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [createType, setCreateType] = useState<KnowledgeSourceType>("URL");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [rawText, setRawText] = useState("");
  const [crawlMode, setCrawlMode] = useState<CrawlMode>("SINGLE");
  const [maxPages, setMaxPages] = useState(DEFAULT_CRAWL_PAGES);
  const [existingFileName, setExistingFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [urlTest, setUrlTest] = useState<UrlTestResult | null>(null);
  const [isTestingUrl, setIsTestingUrl] = useState(false);
  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const agentOptions = useMemo(() => {
    const agents = new Map<string, string>();

    for (const source of sources) {
      if (source.agent) agents.set(source.agent.id, source.agent.name);
    }

    return Array.from(agents, ([id, name]) => ({ id, name })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [sources]);

  const visibleSources = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = sources.filter((source) => {
      const matchesSearch =
        !query ||
        [
          source.title,
          source.sourceUrl,
          source.fileName,
          source.mimeType,
          source.agent?.name,
          typeLabels[source.type],
        ].some((value) => value?.toLowerCase().includes(query));

      const matchesType = typeFilter === "ALL" || source.type === typeFilter;
      const matchesStatus = statusFilter === "ALL" || source.status === statusFilter;
      const matchesAgent =
        agentFilter === "ALL" ||
        (agentFilter === "UNASSIGNED" ? !source.agent : source.agent?.id === agentFilter);

      return matchesSearch && matchesType && matchesStatus && matchesAgent;
    });

    // ISO timestamps sort correctly as strings.
    return filtered.sort((left, right) => {
      if (sortKey === "OLDEST") return left.createdAt.localeCompare(right.createdAt);
      if (sortKey === "NAME") {
        return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
      }
      if (sortKey === "LAST_SYNCED") {
        return (right.lastSyncedAt ?? "").localeCompare(left.lastSyncedAt ?? "");
      }
      return right.createdAt.localeCompare(left.createdAt);
    });
  }, [agentFilter, search, sortKey, sources, statusFilter, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(visibleSources.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pagedSources = visibleSources.slice(pageStart, pageStart + pageSize);

  const summary = useMemo(
    () => ({
      total: sources.length,
      synced: sources.filter((source) => source.status === "SYNCED").length,
      indexing: sources.filter((source) => isIndexing(source.status)).length,
      failed: sources.filter((source) => source.status === "FAILED").length,
    }),
    [sources],
  );

  const hasIndexingSources = summary.indexing > 0;
  const usesPinecone =
    pineconeConfigured || sources.some((source) => source.vectorStore === "pinecone");
  const menuSource = rowMenu ? sources.find((source) => source.id === rowMenu.id) : null;

  const refreshSources = useCallback(async () => {
    const response = await fetch("/api/knowledge-sources", {
      method: "GET",
      cache: "no-store",
    });

    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      knowledgeSources?: Array<KnowledgeSourceItem>;
    };

    if (!response.ok || !data.knowledgeSources) {
      throw new Error(data.error ?? "Unable to refresh knowledge sources.");
    }

    setSources(data.knowledgeSources);
  }, []);

  // Indexing runs in the background; poll until every source settles.
  useEffect(() => {
    if (!hasIndexingSources) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshSources().catch(() => undefined);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [hasIndexingSources, refreshSources]);

  useEffect(() => {
    if (!rowMenu) {
      return;
    }

    function closeMenu() {
      setRowMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setRowMenu(null);
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [rowMenu]);

  async function handleSaveSource() {
    if (isSaving) {
      return;
    }

    setModalError("");
    setSuccess("");

    if (!title.trim()) {
      setModalError("Please enter a title for the knowledge source.");
      return;
    }

    if (createType === "URL") {
      try {
        new URL(sourceUrl.trim());
      } catch {
        setModalError("Enter a full website URL, for example https://example.com/docs.");
        return;
      }

      if (
        crawlMode === "CRAWL" &&
        (!Number.isInteger(maxPages) || maxPages < 2 || maxPages > MAX_CRAWL_PAGES_UI)
      ) {
        setModalError(`Max pages must be a whole number between 2 and ${MAX_CRAWL_PAGES_UI}.`);
        return;
      }
    }

    if (createType === "TEXT" && !rawText.trim()) {
      setModalError("Please enter the text content.");
      return;
    }

    if (createType === "FILE" && !selectedFile && !editingSourceId) {
      setModalError("Choose a file to upload for this source.");
      return;
    }

    setIsSaving(true);

    try {
      let response: Response;

      if (createType === "FILE") {
        const formData = new FormData();
        formData.set("title", title);
        formData.set("type", createType);
        if (selectedFile) formData.set("file", selectedFile);

        response = await fetch(
          editingSourceId
            ? `/api/knowledge-sources/${editingSourceId}`
            : "/api/knowledge-sources",
          {
            method: editingSourceId ? "PATCH" : "POST",
            body: formData,
          },
        );
      } else {
        response = await fetch(
          editingSourceId
            ? `/api/knowledge-sources/${editingSourceId}`
            : "/api/knowledge-sources",
          {
            method: editingSourceId ? "PATCH" : "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title,
              type: createType,
              sourceUrl: createType === "URL" ? sourceUrl.trim() : undefined,
              crawlMode: createType === "URL" ? crawlMode : undefined,
              maxPages:
                createType === "URL"
                  ? crawlMode === "CRAWL"
                    ? maxPages
                    : 1
                  : undefined,
              rawText: createType === "TEXT" ? rawText : undefined,
            }),
          },
        );
      }

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        knowledgeSource?: KnowledgeSourceItem;
      };

      if (!response.ok || !data.knowledgeSource) {
        setModalError(
          data.error ?? "Unable to save knowledge source. Check the details and try again.",
        );
        return;
      }

      const nextSource = data.knowledgeSource;

      setSources((current) => {
        if (editingSourceId) {
          return current.map((source) =>
            source.id === editingSourceId ? nextSource : source,
          );
        }

        return [nextSource, ...current];
      });

      setSuccess(
        isIndexing(nextSource.status)
          ? `"${nextSource.title}" saved and queued for indexing. This list updates automatically.`
          : `"${nextSource.title}" saved.`,
      );
      closeCreateModal();
    } catch {
      setModalError(
        "Unable to save knowledge source. Check your connection and try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTestUrl() {
    if (isTestingUrl) {
      return;
    }

    const url = sourceUrl.trim();
    setModalError("");
    setUrlTest(null);

    try {
      new URL(url);
    } catch {
      setModalError("Enter a full website URL, for example https://example.com/docs, before testing it.");
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
        setModalError(data.error ?? "Unable to test this URL right now. Try again in a moment.");
        return;
      }

      setUrlTest({
        ok: Boolean(data.ok),
        title: data.title ?? null,
        characters: typeof data.characters === "number" ? data.characters : null,
        message: data.message,
      });

      if (data.ok && data.title && !title.trim()) {
        setTitle(data.title);
      }
    } catch {
      setModalError("Unable to reach the server to test this URL. Check your connection.");
    } finally {
      setIsTestingUrl(false);
    }
  }

  async function handleReindexAll() {
    if (isReindexing) {
      return;
    }

    const shouldReindex = window.confirm(
      `Re-index all ${sources.length} sources? Every source is fetched, chunked and embedded again with ${embeddingModel}. ` +
        "Use this after connecting Pinecone or changing the embedding model. Sources are unavailable to agents until they finish re-indexing.",
    );

    if (!shouldReindex) {
      return;
    }

    setError("");
    setSuccess("");
    setIsReindexing(true);

    try {
      const response = await fetch("/api/knowledge-sources/reindex", {
        method: "POST",
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        queued?: number;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to re-index the knowledge base.");
      }

      setSuccess(
        `${data.queued ?? 0} source${data.queued === 1 ? "" : "s"} queued for re-indexing. This list updates automatically.`,
      );
      await refreshSources().catch(() => undefined);
    } catch (thrownError) {
      setError(
        thrownError instanceof Error
          ? thrownError.message
          : "Unable to re-index the knowledge base.",
      );
    } finally {
      setIsReindexing(false);
    }
  }

  function handleFileSelected(file: File | null) {
    if (!file) {
      setSelectedFile(null);
      return;
    }

    const problem = validateKnowledgeFile(file);

    if (problem) {
      setSelectedFile(null);
      setModalError(problem);
      return;
    }

    setModalError("");
    setSelectedFile(file);

    // Default the title to the file name so users can upload in one step.
    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^.]+$/, ""));
    }
  }

  function openCreateModal() {
    setModalError("");
    setEditingSourceId(null);
    setCreateType("URL");
    setTitle("");
    setSourceUrl("");
    setRawText("");
    setCrawlMode("SINGLE");
    setMaxPages(DEFAULT_CRAWL_PAGES);
    setExistingFileName("");
    setSelectedFile(null);
    setUrlTest(null);
    setShowCreateModal(true);
  }

  function openEditModal(source: KnowledgeSourceItem) {
    setModalError("");
    setEditingSourceId(source.id);
    setCreateType(source.type);
    setTitle(source.title);
    setSourceUrl(source.sourceUrl ?? "");
    setRawText(source.rawText ?? "");
    setCrawlMode(source.crawlMode === "CRAWL" ? "CRAWL" : "SINGLE");
    setMaxPages(
      source.crawlMode === "CRAWL" && source.maxPages >= 2
        ? source.maxPages
        : DEFAULT_CRAWL_PAGES,
    );
    setExistingFileName(source.fileName ?? "");
    setSelectedFile(null);
    setUrlTest(null);
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    setShowCreateModal(false);
    setEditingSourceId(null);
    setSelectedFile(null);
    setUrlTest(null);
    setModalError("");
  }

  async function handleResync(source: KnowledgeSourceItem) {
    setError("");
    setSuccess("");
    setActiveActionId(source.id);

    try {
      // The API treats any status as "re-sync now"; the indexer owns the lifecycle.
      const response = await fetch(`/api/knowledge-sources/${source.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "SYNCED" }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        knowledgeSource?: KnowledgeSourceItem;
      };

      if (!response.ok || !data.knowledgeSource) {
        throw new Error(data.error ?? "Unable to re-sync this source.");
      }

      const updatedSource = data.knowledgeSource;

      setSources((current) =>
        current.map((entry) => (entry.id === source.id ? updatedSource : entry)),
      );
      setSuccess(`"${updatedSource.title}" queued for re-sync.`);
    } catch (thrownError) {
      setError(
        thrownError instanceof Error ? thrownError.message : "Unable to re-sync this source.",
      );
    } finally {
      setActiveActionId(null);
    }
  }

  async function handleDelete(source: KnowledgeSourceItem) {
    const shouldDelete = window.confirm(
      `Delete "${source.title}"? Its chunks and vectors are removed and agents stop using its content. This cannot be undone.`,
    );

    if (!shouldDelete) {
      return;
    }

    setError("");
    setSuccess("");
    setActiveActionId(source.id);

    try {
      const response = await fetch(`/api/knowledge-sources/${source.id}`, {
        method: "DELETE",
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to delete this source.");
      }

      setSources((current) => current.filter((entry) => entry.id !== source.id));
      setSuccess(`"${source.title}" deleted.`);
    } catch (thrownError) {
      setError(
        thrownError instanceof Error ? thrownError.message : "Unable to delete this source.",
      );
    } finally {
      setActiveActionId(null);
    }
  }

  const filterSelectClass =
    "h-10 rounded-xl border border-white/10 bg-[#0d0d0d] px-4 text-sm text-white outline-none transition focus:border-white";
  const menuItemClass =
    "block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="heading-font text-[2.05rem] font-bold leading-none text-white">
          Knowledge Base
        </h1>

        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isReindexing || sources.length === 0}
              onClick={() => {
                void handleReindexAll();
              }}
              title="Re-embed every source, e.g. after connecting Pinecone or changing the embedding model"
              className="inline-flex h-10 w-fit items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 text-sm font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-50"
            >
              {isReindexing ? "Queuing..." : "Re-index all"}
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex h-10 w-fit items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black transition hover:bg-neutral-200"
            >
              Add Data Source
            </button>
          </div>
        ) : null}
      </div>

      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
        Upload files, submit website URLs or paste text. Each source is split into
        chunks, embedded and stored in the vector database in the background, and
        your agents search it to answer customers.
        {canManage ? "" : " You have view-only access; ask a manager to add or change sources."}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-white/10 bg-[#0a0a0a] px-4 py-3 text-xs text-slate-400">
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${usesPinecone ? "bg-emerald-400" : "bg-slate-500"}`}
          />
          <span className="font-medium text-slate-200">Vector store:</span>
          {usesPinecone
            ? "Pinecone connected (namespace per workspace)"
            : "Vectors stored in PostgreSQL · add PINECONE_API_KEY and PINECONE_INDEX to use Pinecone"}
        </span>
        <span>
          <span className="font-medium text-slate-200">Embedding model:</span>{" "}
          {isSemanticModel(embeddingModel)
            ? embeddingModel
            : `${embeddingModel} (keyword only) · add an embedding API key for semantic search`}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Total Sources", value: summary.total },
          { label: "Synced", value: summary.synced },
          { label: "Queued / Processing", value: summary.indexing },
          { label: "Failed", value: summary.failed },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-4"
          >
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              {item.label}
            </p>
            <p className="mt-3 text-2xl font-semibold text-white">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="w-full xl:max-w-md">
          <label htmlFor="knowledge-search" className="sr-only">
            Search knowledge sources
          </label>
          <input
            id="knowledge-search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by name, file, URL or agent..."
            className="h-10 w-full rounded-xl border border-white/10 bg-[#0d0d0d] px-4 text-sm text-white outline-none transition focus:border-white"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
          <label htmlFor="knowledge-type-filter" className="sr-only">
            Filter by type
          </label>
          <select
            id="knowledge-type-filter"
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value as typeof typeFilter);
              setPage(1);
            }}
            className={filterSelectClass}
          >
            {typeOptions.map((option) => (
              <option key={option} value={option}>
                {option === "ALL" ? "All types" : typeLabels[option]}
              </option>
            ))}
          </select>

          <label htmlFor="knowledge-status-filter" className="sr-only">
            Filter by vector status
          </label>
          <select
            id="knowledge-status-filter"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as typeof statusFilter);
              setPage(1);
            }}
            className={filterSelectClass}
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option === "ALL" ? "All statuses" : statusLabels[option]}
              </option>
            ))}
          </select>

          <label htmlFor="knowledge-agent-filter" className="sr-only">
            Filter by agent
          </label>
          <select
            id="knowledge-agent-filter"
            value={agentFilter}
            onChange={(event) => {
              setAgentFilter(event.target.value);
              setPage(1);
            }}
            className={filterSelectClass}
          >
            <option value="ALL">All agents</option>
            <option value="UNASSIGNED">Unassigned</option>
            {agentOptions.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>

          <label htmlFor="knowledge-sort" className="sr-only">
            Sort sources
          </label>
          <select
            id="knowledge-sort"
            value={sortKey}
            onChange={(event) => {
              setSortKey(event.target.value as SortKey);
              setPage(1);
            }}
            className={filterSelectClass}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100"
        >
          {error}
        </div>
      ) : null}

      {success ? (
        <div
          role="status"
          className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
        >
          {success}
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-[20px] border border-white/10 bg-[#080808]">
        <div className="overflow-x-auto">
          <table className="min-w-[1040px] divide-y divide-white/10 text-left lg:min-w-full">
            <thead className="bg-white/[0.02] text-xs uppercase tracking-[0.18em] text-slate-400">
              <tr>
                <th scope="col" className="px-5 py-4 font-semibold">Name</th>
                <th scope="col" className="px-5 py-4 font-semibold">Type</th>
                <th scope="col" className="px-5 py-4 font-semibold">Vector Status</th>
                <th scope="col" className="px-5 py-4 font-semibold">Search Mode</th>
                <th scope="col" className="px-5 py-4 font-semibold">Chunks</th>
                <th scope="col" className="px-5 py-4 font-semibold">Agent</th>
                <th scope="col" className="px-5 py-4 font-semibold">Ingested / Synced</th>
                <th scope="col" className="px-5 py-4 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {pagedSources.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-12 text-center text-sm text-slate-400"
                  >
                    {sources.length === 0
                      ? canManage
                        ? "No knowledge sources yet. Use Add Data Source to upload a file, submit a URL or paste text."
                        : "No knowledge sources yet."
                      : "No knowledge sources match your current filters."}
                  </td>
                </tr>
              ) : (
                pagedSources.map((source) => {
                  const searchMode = getSearchMode(source);
                  const isBusy = activeActionId === source.id;

                  return (
                    <tr key={source.id} className="align-top text-sm text-slate-200">
                      <td className="max-w-[20rem] px-5 py-4">
                        <Link
                          href={`/dashboard/knowledge-base/${source.id}`}
                          className="font-semibold text-white transition hover:text-slate-200"
                        >
                          {source.title}
                        </Link>
                        <p className="mt-1 break-all text-xs text-slate-500">
                          {trimPreview(describeSource(source), 80)}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${typePillClass(source.type)}`}
                        >
                          {typeLabels[source.type]}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="space-y-2">
                          <span
                            title={source.processingError ?? undefined}
                            className={`inline-block rounded-full border px-2.5 py-1 text-xs font-medium ${statusPillClass(source.status)}`}
                          >
                            {statusLabels[source.status]}
                          </span>
                          {source.status === "PROCESSING" &&
                          source.type === "URL" &&
                          source.crawlMode === "CRAWL" ? (
                            <p className="text-xs text-slate-500">
                              Crawling up to {source.maxPages} pages...
                            </p>
                          ) : null}
                          {source.status === "FAILED" && source.processingError ? (
                            <details className="max-w-[16rem] text-xs text-red-200">
                              <summary className="cursor-pointer select-none text-red-200/80 hover:text-red-100">
                                Show error
                              </summary>
                              <p className="mt-1 break-words">{source.processingError}</p>
                            </details>
                          ) : null}
                          {source.status === "SYNCED" && source.processingError ? (
                            <p
                              title={source.processingError}
                              className="max-w-[16rem] text-xs text-amber-200"
                            >
                              Keyword search only
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span title={searchMode.hint} className={`text-xs font-medium ${searchMode.className}`}>
                          {searchMode.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-slate-300">
                        <p>{source.chunkCount}</p>
                        {source.type === "URL" && source.pageCount > 1 ? (
                          <p className="mt-1 text-xs text-slate-500">
                            {source.pageCount} pages
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-slate-300">
                        {source.agent?.name ?? <span className="text-slate-500">Unassigned</span>}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-slate-300">
                        <p>{formatDate(source.createdAt, timeZone)}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {source.lastSyncedAt
                            ? `Synced ${formatDate(source.lastSyncedAt, timeZone, true)}`
                            : "Not synced yet"}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          aria-label={`Actions for ${source.title}`}
                          aria-haspopup="menu"
                          aria-expanded={rowMenu?.id === source.id}
                          disabled={isBusy}
                          onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            const opensUp = rect.bottom + 200 > window.innerHeight;

                            setRowMenu((current) =>
                              current?.id === source.id
                                ? null
                                : {
                                    id: source.id,
                                    right: window.innerWidth - rect.right,
                                    ...(opensUp
                                      ? { bottom: window.innerHeight - rect.top + 6 }
                                      : { top: rect.bottom + 6 }),
                                  },
                            );
                          }}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#1a1a1a] disabled:opacity-50"
                        >
                          {isBusy ? (
                            <span className="text-xs" aria-hidden="true">...</span>
                          ) : (
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
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-3 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p>
            {visibleSources.length === 0
              ? "No sources"
              : `Showing ${pageStart + 1}-${pageStart + pagedSources.length} of ${visibleSources.length}`}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="knowledge-page-size" className="text-xs text-slate-500">
              Rows per page
            </label>
            <select
              id="knowledge-page-size"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="h-9 rounded-lg border border-white/10 bg-[#0d0d0d] px-3 text-sm text-white outline-none transition focus:border-white"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            <button
              type="button"
              aria-label="Previous page"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
              className="h-9 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white transition hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-xs text-slate-500">
              Page {currentPage} of {pageCount}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(currentPage + 1)}
              className="h-9 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white transition hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {rowMenu && menuSource ? (
        <div
          role="menu"
          aria-label={`Actions for ${menuSource.title}`}
          style={{ top: rowMenu.top, bottom: rowMenu.bottom, right: rowMenu.right }}
          className="fixed z-40 min-w-[170px] rounded-xl border border-white/10 bg-[#0f0f0f] p-1.5 shadow-[0_14px_32px_rgba(0,0,0,0.45)]"
          onClick={(event) => event.stopPropagation()}
        >
          <Link
            role="menuitem"
            href={`/dashboard/knowledge-base/${menuSource.id}`}
            onClick={() => setRowMenu(null)}
            className={menuItemClass}
          >
            View details
          </Link>
          {canManage ? (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={isIndexing(menuSource.status)}
                title={
                  isIndexing(menuSource.status)
                    ? "Already queued or processing"
                    : "Fetch, chunk and embed this source again"
                }
                onClick={() => {
                  setRowMenu(null);
                  void handleResync(menuSource);
                }}
                className={menuItemClass}
              >
                Re-sync
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setRowMenu(null);
                  openEditModal(menuSource);
                }}
                className={menuItemClass}
              >
                Edit
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setRowMenu(null);
                  void handleDelete(menuSource);
                }}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-200 transition hover:bg-red-500/10"
              >
                Delete
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="knowledge-source-modal-title"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !isSaving) closeCreateModal();
            }}
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[24px] border border-white/10 bg-[#0b0b0b] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="knowledge-source-modal-title"
                  className="text-lg font-semibold text-white"
                >
                  {editingSourceId ? "Edit data source" : "Add data source"}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Upload a file, submit a website URL or paste text. It is indexed
                  automatically after you save.
                </p>
              </div>
              <button
                type="button"
                onClick={closeCreateModal}
                className="rounded-lg border border-white/10 bg-[#151515] px-3 py-1.5 text-sm text-white transition hover:bg-[#1e1e1e]"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-2 text-sm text-slate-300">
                <label htmlFor="knowledge-source-title" className="block">
                  Title
                </label>
                <input
                  id="knowledge-source-title"
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none focus:border-white"
                />
              </div>

              <div className="space-y-2 text-sm text-slate-300">
                <label htmlFor="knowledge-source-type" className="block">
                  Type
                </label>
                <select
                  id="knowledge-source-type"
                  value={createType}
                  disabled={Boolean(editingSourceId)}
                  onChange={(event) => {
                    setCreateType(event.target.value as KnowledgeSourceType);
                    setModalError("");
                  }}
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none focus:border-white disabled:opacity-60"
                >
                  <option value="URL">URL</option>
                  <option value="FILE">File</option>
                  <option value="TEXT">Text</option>
                </select>
              </div>

              {createType === "URL" ? (
                <>
                  <div className="space-y-2 text-sm text-slate-300 md:col-span-2">
                    <label htmlFor="knowledge-source-url" className="block">
                      Source URL
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        id="knowledge-source-url"
                        type="url"
                        value={sourceUrl}
                        onChange={(event) => {
                          setSourceUrl(event.target.value);
                          setUrlTest(null);
                        }}
                        placeholder="https://example.com/docs"
                        className="h-10 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none focus:border-white"
                      />
                      <button
                        type="button"
                        disabled={isTestingUrl || isSaving}
                        onClick={() => {
                          void handleTestUrl();
                        }}
                        className="h-10 shrink-0 rounded-xl border border-white/10 bg-[#151515] px-4 text-sm font-medium text-white transition hover:bg-[#1e1e1e] disabled:opacity-50"
                      >
                        {isTestingUrl ? "Testing..." : "Test URL"}
                      </button>
                    </div>
                    {urlTest ? (
                      <div
                        role="status"
                        className={`rounded-xl border px-4 py-3 text-xs ${
                          urlTest.ok
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                            : "border-amber-500/20 bg-amber-500/10 text-amber-100"
                        }`}
                      >
                        <p>{urlTest.message}</p>
                        {urlTest.title || urlTest.characters !== null ? (
                          <p className="mt-1 opacity-80">
                            {[
                              urlTest.title ? `Page title: ${urlTest.title}` : null,
                              urlTest.characters !== null
                                ? `${urlTest.characters.toLocaleString("en-US")} characters`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <fieldset className="space-y-2 text-sm text-slate-300 md:col-span-2">
                    <legend className="mb-2">What should we read?</legend>
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
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${
                            crawlMode === option.value
                              ? "border-white bg-[#151515]"
                              : "border-white/10 bg-[#111111] hover:border-white/20"
                          }`}
                        >
                          <input
                            type="radio"
                            name="knowledge-source-crawl-mode"
                            value={option.value}
                            checked={crawlMode === option.value}
                            onChange={() => setCrawlMode(option.value)}
                            className="mt-1 accent-white"
                          />
                          <span>
                            <span className="block font-semibold text-white">
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
                    <div className="space-y-2 text-sm text-slate-300">
                      <label htmlFor="knowledge-source-max-pages" className="block">
                        Max pages
                      </label>
                      <input
                        id="knowledge-source-max-pages"
                        type="number"
                        min={2}
                        max={MAX_CRAWL_PAGES_UI}
                        step={1}
                        value={Number.isFinite(maxPages) ? maxPages : ""}
                        onChange={(event) => setMaxPages(event.target.valueAsNumber)}
                        className="h-10 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none focus:border-white"
                      />
                      <span className="block text-xs text-slate-500">
                        Between 2 and {MAX_CRAWL_PAGES_UI}. Crawling runs in the
                        background and can take a minute.
                      </span>
                    </div>
                  ) : null}
                </>
              ) : null}

              {createType === "TEXT" ? (
                <div className="space-y-2 text-sm text-slate-300 md:col-span-2">
                  <label htmlFor="knowledge-source-text" className="block">
                    Text content
                  </label>
                  <textarea
                    id="knowledge-source-text"
                    value={rawText}
                    onChange={(event) => setRawText(event.target.value)}
                    rows={6}
                    className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none focus:border-white"
                  />
                </div>
              ) : null}

              {createType === "FILE" ? (
                <div className="space-y-2 text-sm text-slate-300 md:col-span-2">
                  <p>{editingSourceId ? "Replace file (optional)" : "Upload file"}</p>
                  <KnowledgeFileDropZone
                    id="knowledge-source-file"
                    file={selectedFile}
                    disabled={isSaving}
                    onFileSelected={handleFileSelected}
                  />
                  {editingSourceId && existingFileName && !selectedFile ? (
                    <p className="text-xs text-slate-500">
                      Current file: {existingFileName}. Leave empty to keep it.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {modalError ? (
              <div
                role="alert"
                className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100"
              >
                {modalError}
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeCreateModal}
                className="rounded-xl border border-white/10 bg-[#121212] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  void handleSaveSource();
                }}
                className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-50"
              >
                {isSaving
                  ? createType === "FILE" && selectedFile
                    ? "Uploading..."
                    : "Saving..."
                  : editingSourceId
                    ? "Update Source"
                    : "Save Source"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
