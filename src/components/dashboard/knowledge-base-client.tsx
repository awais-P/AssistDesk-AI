"use client";

import { useMemo, useState } from "react";
import { DashboardPageHeader } from "./dashboard-page-header";

type KnowledgeSourceType = "FILE" | "URL" | "TEXT";
type SyncStatus = "PENDING" | "PROCESSING" | "SYNCED" | "FAILED" | "DELETED";

type KnowledgeSourceItem = {
  id: string;
  title: string;
  type: KnowledgeSourceType;
  status: SyncStatus;
  sourceUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  rawText: string | null;
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
    rawText: string | null;
    createdAt: Date;
    updatedAt: Date;
    lastSyncedAt: Date | null;
    agent: { id: string; name: string } | null;
  }>;
};

const typeOptions: Array<KnowledgeSourceType | "ALL"> = ["ALL", "URL", "TEXT", "FILE"];
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

export function KnowledgeBaseClient({ initialSources }: KnowledgeBaseClientProps) {
  const [sources, setSources] = useState<KnowledgeSourceItem[]>(
    [...initialSources].map((source) => ({
      ...source,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
      lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
    })),
  );
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<(typeof typeOptions)[number]>("ALL");
  const [statusFilter, setStatusFilter] = useState<(typeof statusOptions)[number]>("ALL");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [createType, setCreateType] = useState<KnowledgeSourceType>("URL");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState("");
  const [mimeType, setMimeType] = useState("");
  const [statusValue, setStatusValue] = useState<SyncStatus>("PENDING");
  const [error, setError] = useState("");
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

  const summary = useMemo(() => {
    return {
      total: sources.length,
      synced: sources.filter((source) => source.status === "SYNCED").length,
      pending: sources.filter((source) => source.status === "PENDING").length,
      failed: sources.filter((source) => source.status === "FAILED").length,
    };
  }, [sources]);

  async function refreshSource(id: string, payload: Record<string, unknown>) {
    const response = await fetch(`/api/knowledge-sources/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as {
      error?: string;
      knowledgeSource?: {
        id: string;
        title: string;
        type: KnowledgeSourceType;
        status: SyncStatus;
        sourceUrl: string | null;
        fileName: string | null;
        mimeType: string | null;
        rawText: string | null;
        createdAt: string;
        updatedAt: string;
        lastSyncedAt: string | null;
        agent: { id: string; name: string } | null;
      };
    };

    if (!response.ok || !data.knowledgeSource) {
      throw new Error(data.error ?? "Unable to update knowledge source.");
    }

    return data.knowledgeSource;
  }

  async function handleSaveSource() {
    setError("");
    setIsSaving(true);

    try {
      if (!title.trim()) {
        setError("Please enter a title for the knowledge source.");
        return;
      }

      if (createType === "URL" && !sourceUrl.trim()) {
        setError("Please enter a source URL.");
        return;
      }

      if (createType === "TEXT" && !rawText.trim()) {
        setError("Please enter the text content.");
        return;
      }

      if (createType === "FILE" && !fileName.trim()) {
        setError("Please enter a file name.");
        return;
      }

      const response = await fetch(
        editingSourceId ? `/api/knowledge-sources/${editingSourceId}` : "/api/knowledge-sources",
        {
          method: editingSourceId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
          body: JSON.stringify({
            title,
            type: createType,
            status: statusValue,
            sourceUrl: createType === "URL" ? sourceUrl : undefined,
            rawText: createType === "TEXT" ? rawText : undefined,
            fileName: createType === "FILE" ? fileName : undefined,
            mimeType: createType === "FILE" ? mimeType : undefined,
          }),
        },
      );

      const data = (await response.json()) as {
        error?: string;
        knowledgeSource?: {
          id: string;
          title: string;
          type: KnowledgeSourceType;
          status: SyncStatus;
          sourceUrl: string | null;
          fileName: string | null;
          mimeType: string | null;
          rawText: string | null;
          createdAt: string;
          updatedAt: string;
          lastSyncedAt: string | null;
          agent: { id: string; name: string } | null;
        };
      };

      if (!response.ok || !data.knowledgeSource) {
        setError(data.error ?? "Unable to save knowledge source.");
        return;
      }

      const nextSource = data.knowledgeSource as KnowledgeSourceItem;

      setSources((current) => {
        if (editingSourceId) {
          return current.map((source) => (source.id === editingSourceId ? nextSource : source));
        }

        return [nextSource, ...current];
      });
      setShowCreateModal(false);
      setEditingSourceId(null);
      setTitle("");
      setSourceUrl("");
      setRawText("");
      setFileName("");
      setMimeType("");
      setCreateType("URL");
      setStatusValue("PENDING");
    } catch (thrownError) {
      setError(
        thrownError instanceof Error
          ? thrownError.message
          : "Unable to save knowledge source.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function openCreateModal() {
    setError("");
    setEditingSourceId(null);
    setCreateType("URL");
    setTitle("");
    setSourceUrl("");
    setRawText("");
    setFileName("");
    setMimeType("");
    setStatusValue("PENDING");
    setShowCreateModal(true);
  }

  function openEditModal(source: KnowledgeSourceItem) {
    setError("");
    setEditingSourceId(source.id);
    setCreateType(source.type);
    setTitle(source.title);
    setSourceUrl(source.sourceUrl ?? "");
    setRawText(source.rawText ?? "");
    setFileName(source.fileName ?? "");
    setMimeType(source.mimeType ?? "");
    setStatusValue(source.status);
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    setShowCreateModal(false);
    setEditingSourceId(null);
    setError("");
  }

  async function handleAction(
    id: string,
    payload: Record<string, unknown> | null,
    fallbackMessage: string,
  ) {
    setActiveActionId(id);

    try {
      if (payload) {
        const updated = await refreshSource(id, payload);

        setSources((current) =>
          current.map((source) =>
            source.id === id ? ({ ...source, ...updated } as KnowledgeSourceItem) : source,
          ),
        );
      } else {
        const response = await fetch(`/api/knowledge-sources/${id}`, {
          method: "DELETE",
        });

        const data = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(data.error ?? fallbackMessage);
        }

        setSources((current) => current.filter((source) => source.id !== id));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : fallbackMessage);
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
        Manage workspace-scoped URLs, text snippets, and file metadata that can
        later feed assistant retrieval. The workflow is intentionally simple for
        the FYP demo, but it stays fully database-backed.
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
            onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
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
        <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
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
                <th className="px-5 py-4 font-semibold">Created</th>
                <th className="px-5 py-4 font-semibold">Synced</th>
                <th className="px-5 py-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {filteredSources.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-slate-400">
                    No knowledge sources match your current filters.
                  </td>
                </tr>
              ) : (
                filteredSources.map((source) => (
                  <tr key={source.id} className="align-top text-sm text-slate-200">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-white">{source.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {trimPreview(source.rawText || source.sourceUrl || source.fileName, 70) ||
                          "No preview available"}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${typePillClass(source.type)}`}>
                        {formatType(source.type)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusPillClass(source.status)}`}>
                        {formatStatus(source.status)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      {source.type === "URL"
                        ? source.sourceUrl ?? "No URL"
                        : source.type === "FILE"
                          ? [source.fileName, source.mimeType].filter(Boolean).join(" • ") || "No file metadata"
                          : trimPreview(source.rawText, 90) || "No text content"}
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      {source.agent?.name ?? "Unassigned"}
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      {formatDate(source.createdAt)}
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      {formatDate(source.lastSyncedAt)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
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
                              "Unable to mark as processing.",
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
                              "Unable to mark as synced.",
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
                              "Unable to retry sync.",
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
                              "Unable to delete source.",
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
          <div className="w-full max-w-2xl rounded-[24px] border border-white/10 bg-[#0b0b0b] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-white">
                  {editingSourceId ? "Edit knowledge source" : "Add knowledge source"}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  Create a URL, text note, or file metadata entry for this workspace.
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
                  onChange={(event) => setCreateType(event.target.value as KnowledgeSourceType)}
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none focus:border-white"
                >
                  <option value="URL">URL</option>
                  <option value="TEXT">TEXT</option>
                  <option value="FILE">FILE</option>
                </select>
              </label>

              <label className="space-y-2 text-sm text-slate-300">
                <span>Status</span>
                <select
                  value={statusValue}
                  onChange={(event) => setStatusValue(event.target.value as SyncStatus)}
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none focus:border-white"
                >
                  {statusOptions.filter((option) => option !== "ALL").map((option) => (
                    <option key={option} value={option}>
                      {option.toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>

              {createType === "URL" ? (
                <label className="space-y-2 text-sm text-slate-300 md:col-span-2">
                  <span>Source URL</span>
                  <input
                    type="url"
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    className="h-10 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none focus:border-white"
                  />
                </label>
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
                <>
                  <label className="space-y-2 text-sm text-slate-300">
                    <span>File name</span>
                    <input
                      type="text"
                      value={fileName}
                      onChange={(event) => setFileName(event.target.value)}
                      className="h-10 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none focus:border-white"
                    />
                  </label>

                  <label className="space-y-2 text-sm text-slate-300">
                    <span>MIME type</span>
                    <input
                      type="text"
                      value={mimeType}
                      onChange={(event) => setMimeType(event.target.value)}
                      placeholder="application/pdf"
                      className="h-10 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none focus:border-white"
                    />
                  </label>
                </>
              ) : null}
            </div>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {error}
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
                {editingSourceId ? "Update Source" : "Save Source"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}