"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  MAX_CRAWL_PAGES_UI,
  MAX_KNOWLEDGE_FILE_MB,
  knowledgeFileAcceptAttribute,
  knowledgeFileExtensions,
  knowledgeFileTypesLabel,
} from "@/src/lib/knowledge-file-types";
import { DashboardPageHeader } from "./dashboard-page-header";

type KnowledgeSourceType = "FILE" | "URL" | "TEXT";
type SyncStatus = "PENDING" | "PROCESSING" | "SYNCED" | "FAILED" | "DELETED";
type CrawlMode = "SINGLE" | "CRAWL";

const DEFAULT_CRAWL_PAGES = 10;

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
    vectorIndexedAt: Date | null;
    processingError: string | null;
    createdAt: Date;
    updatedAt: Date;
    lastSyncedAt: Date | null;
    agent: { id: string; name: string } | null;
  }>;
};

const typeOptions: Array<KnowledgeSourceType | "ALL"> = [
  "ALL",
  "URL",
  "TEXT",
  "FILE",
];
const statusOptions: Array<SyncStatus | "ALL"> = [
  "ALL",
  "PENDING",
  "PROCESSING",
  "SYNCED",
  "FAILED",
  "DELETED",
];

function formatDate(value: string | null) {
  if (!value) return "Not synced";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null) {
  if (!value) return "Not available";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatStatus(status: SyncStatus) {
  return status.toLowerCase().replaceAll("_", " ");
}

function formatType(type: KnowledgeSourceType) {
  return type.toLowerCase();
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
}: KnowledgeBaseClientProps) {
  const [sources, setSources] = useState<KnowledgeSourceItem[]>(
    initialSources.map(mapSource),
  );
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] =
    useState<(typeof typeOptions)[number]>("ALL");
  const [statusFilter, setStatusFilter] =
    useState<(typeof statusOptions)[number]>("ALL");
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
  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  const filteredSources = useMemo(() => {
    const query = search.trim().toLowerCase();

    return sources.filter((source) => {
      const matchesSearch =
        !query ||
        source.title.toLowerCase().includes(query) ||
        (source.sourceUrl?.toLowerCase().includes(query) ?? false) ||
        (source.fileName?.toLowerCase().includes(query) ?? false) ||
        (source.rawText?.toLowerCase().includes(query) ?? false) ||
        (source.agent?.name.toLowerCase().includes(query) ?? false);

      const matchesType = typeFilter === "ALL" || source.type === typeFilter;
      const matchesStatus =
        statusFilter === "ALL" || source.status === statusFilter;

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [search, sources, statusFilter, typeFilter]);

  const summary = useMemo(
    () => ({
      total: sources.length,
      synced: sources.filter((source) => source.status === "SYNCED").length,
      pending: sources.filter((source) => source.status === "PENDING").length,
      failed: sources.filter((source) => source.status === "FAILED").length,
    }),
    [sources],
  );

  const hasProcessingSources = useMemo(
    () => sources.some((source) => source.status === "PROCESSING"),
    [sources],
  );

  async function refreshSources() {
    const response = await fetch("/api/knowledge-sources", {
      method: "GET",
      cache: "no-store",
    });

    const data = (await response.json()) as {
      error?: string;
      knowledgeSources?: Array<KnowledgeSourceItem>;
    };

    if (!response.ok || !data.knowledgeSources) {
      throw new Error(data.error ?? "Unable to refresh knowledge sources.");
    }

    setSources(data.knowledgeSources);
  }

  useEffect(() => {
    if (!hasProcessingSources) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshSources().catch(() => undefined);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [hasProcessingSources]);

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
        nextSource.status === "PROCESSING"
          ? `"${nextSource.title}" saved. It is being processed in the background; this list updates automatically.`
          : `"${nextSource.title}" saved.`,
      );
      closeCreateModal();
    } catch (thrownError) {
      setModalError(
        thrownError instanceof Error
          ? thrownError.message
          : "Unable to save knowledge source. Check your connection and try again.",
      );
    } finally {
      setIsSaving(false);
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
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    setShowCreateModal(false);
    setEditingSourceId(null);
    setSelectedFile(null);
    setModalError("");
  }

  async function handleAction(
    id: string,
    payload: Record<string, unknown> | null,
    fallbackMessage: string,
  ) {
    if (!payload) {
      const source = sources.find((entry) => entry.id === id);
      const shouldDelete = window.confirm(
        `Delete "${source?.title ?? "this source"}"? Agents will stop using its content. This cannot be undone.`,
      );

      if (!shouldDelete) {
        return;
      }
    }

    setError("");
    setSuccess("");
    setActiveActionId(id);

    try {
      if (payload) {
        const response = await fetch(`/api/knowledge-sources/${id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          knowledgeSource?: KnowledgeSourceItem;
        };

        if (!response.ok || !data.knowledgeSource) {
          throw new Error(data.error ?? fallbackMessage);
        }

        const updatedSource = data.knowledgeSource;

        setSources((current) =>
          current.map((source) => (source.id === id ? updatedSource : source)),
        );
        setSuccess(`"${updatedSource.title}" queued for processing.`);
      } else {
        const response = await fetch(`/api/knowledge-sources/${id}`, {
          method: "DELETE",
        });

        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? fallbackMessage);
        }

        setSources((current) => current.filter((source) => source.id !== id));
        setSuccess("Knowledge source deleted.");
      }
    } catch (thrownError) {
      setError(
        thrownError instanceof Error ? thrownError.message : fallbackMessage,
      );
    } finally {
      setActiveActionId(null);
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <DashboardPageHeader
        title="Knowledge Base"
        actionLabel="Add Source"
        actionStyle="light"
        onActionClick={openCreateModal}
      />

      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
        Manage workspace-scoped URLs, text notes, and uploaded files that feed
        your agents. Sources are processed in the background, chunked into
        searchable knowledge, and then made available to the current runtime.
      </p>

      <div className="mt-6 grid gap-3 md:grid-cols-4">
        {[
          { label: "Total Sources", value: summary.total },
          { label: "Synced", value: summary.synced },
          { label: "Pending", value: summary.pending },
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

      <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by title, URL, file name, or agent..."
          className="h-10 w-full rounded-xl border border-white/10 bg-[#0d0d0d] px-4 text-sm text-white outline-none transition focus:border-white lg:max-w-lg"
        />

        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(event.target.value as typeof typeFilter)
            }
            className="h-10 rounded-xl border border-white/10 bg-[#0d0d0d] px-4 text-sm text-white outline-none transition focus:border-white"
          >
            {typeOptions.map((option) => (
              <option key={option} value={option}>
                {option === "ALL" ? "All types" : option.toLowerCase()}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as typeof statusFilter)
            }
            className="h-10 rounded-xl border border-white/10 bg-[#0d0d0d] px-4 text-sm text-white outline-none transition focus:border-white"
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option === "ALL" ? "All statuses" : option.toLowerCase()}
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
        <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {success}
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-[20px] border border-white/10 bg-[#080808]">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/10 text-left">
            <thead className="bg-white/[0.02] text-xs uppercase tracking-[0.18em] text-slate-400">
              <tr>
                <th className="px-5 py-4 font-semibold">Title</th>
                <th className="px-5 py-4 font-semibold">Type</th>
                <th className="px-5 py-4 font-semibold">Status</th>
                <th className="px-5 py-4 font-semibold">Source</th>
                <th className="px-5 py-4 font-semibold">Agent</th>
                <th className="px-5 py-4 font-semibold">Indexed</th>
                <th className="px-5 py-4 font-semibold">Synced</th>
                <th className="px-5 py-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {filteredSources.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-12 text-center text-sm text-slate-400"
                  >
                    No knowledge sources match your current filters.
                  </td>
                </tr>
              ) : (
                filteredSources.map((source) => (
                  <tr key={source.id} className="align-top text-sm text-slate-200">
                    <td className="px-5 py-4">
                      <Link
                        href={`/dashboard/knowledge-base/${source.id}`}
                        className="font-semibold text-white transition hover:text-slate-200"
                      >
                        {source.title}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500">
                        {trimPreview(
                          source.rawText ||
                            source.sourceUrl ||
                            source.fileName ||
                            source.processingError,
                          70,
                        ) || "No preview available"}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium ${typePillClass(source.type)}`}
                      >
                        {formatType(source.type)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="space-y-2">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusPillClass(source.status)}`}
                        >
                          {formatStatus(source.status)}
                        </span>
                        {source.processingError ? (
                          <p className="max-w-[16rem] text-xs text-red-200">
                            {trimPreview(source.processingError, 80)}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      {source.type === "URL" ? (
                        <>
                          <p className="break-all">{source.sourceUrl ?? "No URL"}</p>
                          {source.pageCount > 1 ? (
                            <p className="mt-1 text-xs text-slate-500">
                              {source.pageCount} pages
                            </p>
                          ) : source.crawlMode === "CRAWL" &&
                            source.status === "PROCESSING" ? (
                            <p className="mt-1 text-xs text-slate-500">
                              Crawling up to {source.maxPages} pages...
                            </p>
                          ) : null}
                        </>
                      ) : source.type === "FILE"
                          ? [source.fileName, source.mimeType, formatFileSize(source.fileSize)]
                              .filter(Boolean)
                              .join(" • ") || "No file metadata"
                          : trimPreview(source.rawText, 90) || "No text content"}
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      {source.agent?.name ?? "Unassigned"}
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      <p>{source.chunkCount} chunks</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDateTime(source.vectorIndexedAt)}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      {formatDate(source.lastSyncedAt)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/dashboard/knowledge-base/${source.id}`}
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/10"
                        >
                          View
                        </Link>
                        <button
                          type="button"
                          disabled={isSaving || activeActionId === source.id}
                          onClick={() => openEditModal(source)}
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={isSaving || activeActionId === source.id}
                          onClick={() => {
                            void handleAction(
                              source.id,
                              { status: "PROCESSING" },
                              "Unable to process this source.",
                            );
                          }}
                          className="rounded-lg border border-white/10 bg-[#121212] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#1b1b1b] disabled:opacity-50"
                        >
                          Process
                        </button>
                        <button
                          type="button"
                          disabled={isSaving || activeActionId === source.id}
                          onClick={() => {
                            void handleAction(
                              source.id,
                              { status: "SYNCED" },
                              "Unable to sync this source.",
                            );
                          }}
                          className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-50"
                        >
                          Sync
                        </button>
                        <button
                          type="button"
                          disabled={isSaving || activeActionId === source.id}
                          onClick={() => {
                            void handleAction(
                              source.id,
                              { status: "PENDING" },
                              "Unable to retry this source.",
                            );
                          }}
                          className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-50"
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          disabled={isSaving || activeActionId === source.id}
                          onClick={() => {
                            void handleAction(
                              source.id,
                              null,
                              "Unable to delete this source.",
                            );
                          }}
                          className="rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#262626] disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[24px] border border-white/10 bg-[#0b0b0b] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-white">
                  {editingSourceId
                    ? "Edit knowledge source"
                    : "Add knowledge source"}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  Create a URL, text note, or uploaded file source for this
                  workspace knowledge base.
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
              <label className="space-y-2 text-sm text-slate-300">
                <span>Title</span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none focus:border-white"
                />
              </label>

              <label className="space-y-2 text-sm text-slate-300">
                <span>Type</span>
                <select
                  value={createType}
                  disabled={Boolean(editingSourceId)}
                  onChange={(event) => {
                    setCreateType(event.target.value as KnowledgeSourceType);
                    setModalError("");
                  }}
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none focus:border-white disabled:opacity-60"
                >
                  <option value="URL">URL</option>
                  <option value="TEXT">TEXT</option>
                  <option value="FILE">FILE</option>
                </select>
              </label>

              {createType === "URL" ? (
                <>
                  <label className="space-y-2 text-sm text-slate-300 md:col-span-2">
                    <span>Source URL</span>
                    <input
                      type="url"
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      placeholder="https://example.com/docs"
                      className="h-10 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none focus:border-white"
                    />
                  </label>

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
                    <label className="space-y-2 text-sm text-slate-300">
                      <span>Max pages</span>
                      <input
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
                    </label>
                  ) : null}
                </>
              ) : null}

              {createType === "TEXT" ? (
                <label className="space-y-2 text-sm text-slate-300 md:col-span-2">
                  <span>Text content</span>
                  <textarea
                    value={rawText}
                    onChange={(event) => setRawText(event.target.value)}
                    rows={6}
                    className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none focus:border-white"
                  />
                </label>
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
