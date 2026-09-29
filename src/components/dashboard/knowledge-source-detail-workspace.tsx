"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

type SyncStatus = "PENDING" | "PROCESSING" | "SYNCED" | "FAILED" | "DELETED";

/** Mirrors LEXICAL_EMBEDDING_MODEL in src/lib/embeddings.ts (server-only module). */
const LEXICAL_EMBEDDING_MODEL = "lexical-hash-v2";
const MAX_QUESTION_LENGTH = 500;
const TEXT_PREVIEW_LENGTH = 3000;
const CHUNK_PREVIEW_LENGTH = 320;

type KnowledgeSourceDetailProps = {
  canManage: boolean;
  source: {
    id: string;
    title: string;
    type: "FILE" | "URL" | "TEXT";
    status: SyncStatus;
    sourceUrl: string | null;
    fileName: string | null;
    mimeType: string | null;
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
    agent: { id: string; name: string } | null;
  };
  chunks: Array<{
    id: string;
    chunkIndex: number;
    content: string;
    tokenCount: number;
    embeddingModel: string | null;
  }>;
  chunkPagination: {
    page: number;
    pageCount: number;
    perPage: number;
    total: number;
  };
};

type RetrievalMatch = {
  sourceId: string;
  chunkIndex: number;
  title: string;
  excerpt: string;
  score: number;
  semanticScore: number | null;
  keywordScore: number;
};

type RetrievalResult = {
  question: string;
  matches: RetrievalMatch[];
  searchedSources: number;
};

const statusLabels: Record<SyncStatus, string> = {
  PENDING: "Queued",
  PROCESSING: "Processing",
  SYNCED: "Synced",
  FAILED: "Failed",
  DELETED: "Deleted",
};

const typeLabels = {
  FILE: "File",
  URL: "URL",
  TEXT: "Text",
} as const;

function formatDateTime(value: string | null, timeZone: string | null) {
  if (!value) {
    return "Not available";
  }

  // Rendered only after mount so server and browser markup always match.
  if (!timeZone) {
    return "...";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function formatFileSize(size: number | null) {
  if (!size) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isSemanticModel(model: string | null) {
  return Boolean(model && model !== LEXICAL_EMBEDDING_MODEL && model.includes(":"));
}

function describeSearchMode(source: KnowledgeSourceDetailProps["source"]) {
  if (source.chunkCount === 0 || !source.embeddingModel) {
    return "Not indexed yet";
  }

  if (!isSemanticModel(source.embeddingModel)) {
    return "Keyword (offline model)";
  }

  return source.vectorStore === "pinecone" ? "Semantic · Pinecone" : "Semantic · PostgreSQL";
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

function ScoreBar({
  label,
  value,
  barClassName,
}: {
  label: string;
  value: number | null;
  barClassName: string;
}) {
  const percent = value === null ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="font-medium text-slate-200">
          {percent === null ? "n/a" : `${percent}%`}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"
        {...(percent === null
          ? { "aria-hidden": true }
          : {
              role: "meter",
              "aria-label": `${label} score`,
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-valuenow": percent,
            })}
      >
        <div
          className={`h-full rounded-full ${barClassName}`}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#101010] px-4 py-3">
      <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</dt>
      <dd className="mt-2 break-words text-white">{children}</dd>
    </div>
  );
}

export function KnowledgeSourceDetailWorkspace({
  canManage,
  source,
  chunks,
  chunkPagination,
}: KnowledgeSourceDetailProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeAction, setActiveAction] = useState<"RESYNC" | "DELETE" | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [showFullText, setShowFullText] = useState(false);
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(() => new Set());
  const [question, setQuestion] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [retrieval, setRetrieval] = useState<RetrievalResult | null>(null);

  const isIndexing = source.status === "PENDING" || source.status === "PROCESSING";
  const rawText = source.rawText ?? "";
  const isTextTruncated = rawText.length > TEXT_PREVIEW_LENGTH && !showFullText;

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  // Indexing runs in the background; refresh until it settles.
  useEffect(() => {
    if (!isIndexing) {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, 4000);

    return () => window.clearInterval(interval);
  }, [isIndexing, router]);

  async function handleResync() {
    setError("");
    setSuccess("");
    setActiveAction("RESYNC");

    try {
      // The API treats any status as "re-sync now"; the indexer owns the lifecycle.
      const response = await fetch(`/api/knowledge-sources/${source.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "SYNCED" }),
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to re-sync this source.");
      }

      setSuccess("Queued for re-sync. This page updates automatically when indexing finishes.");
      router.refresh();
    } catch (thrownError) {
      setError(
        thrownError instanceof Error ? thrownError.message : "Unable to re-sync this source.",
      );
    } finally {
      setActiveAction(null);
    }
  }

  async function handleDelete() {
    const shouldDelete = window.confirm(
      `Delete "${source.title}"? Its chunks and vectors are removed and agents stop using its content. This cannot be undone.`,
    );

    if (!shouldDelete) {
      return;
    }

    setError("");
    setSuccess("");
    setActiveAction("DELETE");

    try {
      const response = await fetch(`/api/knowledge-sources/${source.id}`, {
        method: "DELETE",
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to delete this source.");
      }

      router.push("/dashboard/knowledge-base");
      router.refresh();
    } catch (thrownError) {
      setError(
        thrownError instanceof Error ? thrownError.message : "Unable to delete this source.",
      );
      setActiveAction(null);
    }
  }

  async function handleTestRetrieval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuestion = question.trim();

    if (isSearching) {
      return;
    }

    if (!trimmedQuestion) {
      setSearchError("Type a question a customer might ask.");
      return;
    }

    setSearchError("");
    setIsSearching(true);

    try {
      const response = await fetch("/api/knowledge-sources/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: trimmedQuestion, sourceIds: [source.id] }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        matches?: RetrievalMatch[];
        searchedSources?: number;
      };

      if (!response.ok || !data.matches) {
        throw new Error(data.error ?? "The knowledge base search failed. Try again.");
      }

      setRetrieval({
        question: trimmedQuestion,
        matches: data.matches,
        searchedSources: data.searchedSources ?? 0,
      });
    } catch (thrownError) {
      setSearchError(
        thrownError instanceof Error
          ? thrownError.message
          : "Unable to reach the server. Check your connection and try again.",
      );
    } finally {
      setIsSearching(false);
    }
  }

  function toggleChunk(id: string) {
    setExpandedChunks((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function chunkHref(page: number, chunkIndex?: number) {
    return `/dashboard/knowledge-base/${source.id}?chunkPage=${page}${
      chunkIndex === undefined ? "" : `#chunk-${chunkIndex}`
    }`;
  }

  const fileDetails = [source.fileName, source.mimeType, formatFileSize(source.fileSize)]
    .filter(Boolean)
    .join(" · ");
  const firstChunkNumber = (chunkPagination.page - 1) * chunkPagination.perPage + 1;

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link
            href="/dashboard/knowledge-base"
            className="text-sm text-slate-400 transition hover:text-white"
          >
            ← Back to Knowledge Base
          </Link>
          <h1 className="mt-3 break-words text-3xl font-semibold text-white">
            {source.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <span className="rounded-full border border-white/10 bg-[#121212] px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-300">
              {typeLabels[source.type]}
            </span>
            <span
              className={`rounded-full border px-3 py-1 text-xs ${statusPillClass(source.status)}`}
            >
              {statusLabels[source.status]}
            </span>
            <span>{source.chunkCount} indexed chunks</span>
            <span aria-hidden="true">·</span>
            <span>{describeSearchMode(source)}</span>
          </div>
        </div>

        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={activeAction !== null || isIndexing}
              title={isIndexing ? "Already queued or processing" : undefined}
              onClick={() => {
                void handleResync();
              }}
              className="rounded-xl border border-white/10 bg-[#151515] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1e1e1e] disabled:opacity-50"
            >
              {activeAction === "RESYNC"
                ? "Queuing..."
                : isIndexing
                  ? `${statusLabels[source.status]}...`
                  : "Re-sync"}
            </button>
            <button
              type="button"
              disabled={activeAction !== null}
              onClick={() => {
                void handleDelete();
              }}
              className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-100 transition hover:bg-red-500/15 disabled:opacity-50"
            >
              {activeAction === "DELETE" ? "Deleting..." : "Delete"}
            </button>
          </div>
        ) : null}
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

      {source.status === "SYNCED" && source.processingError ? (
        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <p className="font-medium">Keyword search only</p>
          <p className="mt-1 text-amber-100/80">{source.processingError}</p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(320px,1fr)]">
        <div className="min-w-0 space-y-4">
          <section
            aria-labelledby="test-retrieval-title"
            className="rounded-[24px] border border-white/10 bg-[#090909] p-5"
          >
            <h2 id="test-retrieval-title" className="text-lg font-semibold text-white">
              Test Retrieval
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Ask a question the way a customer would. This runs the same hybrid
              search (semantic vectors plus keywords) the assistant uses before it
              answers, limited to this source.
            </p>

            <form onSubmit={(event) => void handleTestRetrieval(event)} className="mt-4">
              <label
                htmlFor="retrieval-question"
                className="mb-2 block text-sm font-medium text-slate-300"
              >
                Question
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="retrieval-question"
                  type="text"
                  value={question}
                  maxLength={MAX_QUESTION_LENGTH}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="e.g. How long does a refund take?"
                  className="h-11 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none transition focus:border-white"
                />
                <button
                  type="submit"
                  disabled={isSearching || !question.trim()}
                  className="h-11 shrink-0 rounded-xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-50"
                >
                  {isSearching ? "Searching..." : "Search"}
                </button>
              </div>
            </form>

            {source.status !== "SYNCED" ? (
              <p className="mt-3 text-xs text-amber-200">
                {isIndexing
                  ? "This source is still being indexed; results may be incomplete until it shows Synced."
                  : "This source is not synced, so it may return no matches. Re-sync it first."}
              </p>
            ) : null}

            {searchError ? (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100"
              >
                {searchError}
              </p>
            ) : null}

            {retrieval ? (
              <div className="mt-4 space-y-3" aria-live="polite">
                <p className="text-xs text-slate-500">
                  {retrieval.matches.length} match
                  {retrieval.matches.length === 1 ? "" : "es"} for &ldquo;{retrieval.question}
                  &rdquo; · searched {retrieval.searchedSources} source
                  {retrieval.searchedSources === 1 ? "" : "s"}
                </p>

                {retrieval.matches.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-[#101010] px-4 py-6 text-center text-sm text-slate-500">
                    No relevant chunks found. The assistant would not use this
                    source for that question.
                  </div>
                ) : (
                  retrieval.matches.map((match, index) => (
                    <article
                      key={`${match.sourceId}:${match.chunkIndex}`}
                      className="rounded-2xl border border-white/10 bg-[#101010] p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-white">
                          #{index + 1} · Chunk {match.chunkIndex + 1}
                        </p>
                        <Link
                          href={chunkHref(
                            Math.floor(match.chunkIndex / chunkPagination.perPage) + 1,
                            match.chunkIndex,
                          )}
                          className="text-xs text-slate-400 underline-offset-4 transition hover:text-white hover:underline"
                        >
                          Jump to chunk
                        </Link>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <ScoreBar label="Overall" value={match.score} barClassName="bg-white" />
                        <ScoreBar
                          label="Semantic"
                          value={match.semanticScore}
                          barClassName="bg-emerald-400"
                        />
                        <ScoreBar
                          label="Keyword"
                          value={match.keywordScore}
                          barClassName="bg-amber-300"
                        />
                      </div>
                      {match.semanticScore === null ? (
                        <p className="mt-2 text-xs text-slate-500">
                          Semantic score unavailable: this source uses the keyword model.
                        </p>
                      ) : null}
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
                        {match.excerpt}
                      </p>
                    </article>
                  ))
                )}
              </div>
            ) : null}
          </section>

          <section className="rounded-[24px] border border-white/10 bg-[#090909] p-5">
            <h2 className="text-lg font-semibold text-white">Extracted Content</h2>
            <p className="mt-2 text-sm text-slate-400">
              The normalized text read from this source
              {rawText ? ` (${rawText.length.toLocaleString("en-US")} characters)` : ""}.
              It is split into the chunks below for retrieval.
            </p>
            <div className="mt-4 max-h-[28rem] overflow-y-auto rounded-2xl border border-white/10 bg-[#111111] p-4">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-200">
                {rawText
                  ? isTextTruncated
                    ? `${rawText.slice(0, TEXT_PREVIEW_LENGTH)}...`
                    : rawText
                  : "No readable content has been extracted yet."}
              </pre>
            </div>
            {rawText.length > TEXT_PREVIEW_LENGTH ? (
              <button
                type="button"
                aria-expanded={showFullText}
                onClick={() => setShowFullText((current) => !current)}
                className="mt-3 rounded-lg border border-white/10 bg-[#151515] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#1e1e1e]"
              >
                {showFullText ? "Show less" : "Show full text"}
              </button>
            ) : null}
          </section>

          <section
            aria-labelledby="indexed-chunks-title"
            className="rounded-[24px] border border-white/10 bg-[#090909] p-5"
          >
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="indexed-chunks-title" className="text-lg font-semibold text-white">
                  Indexed Chunks
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  Each chunk is embedded separately and stored in the vector
                  database.
                </p>
              </div>
              {chunkPagination.total > 0 ? (
                <p className="text-xs text-slate-500">
                  {firstChunkNumber}-{firstChunkNumber + chunks.length - 1} of{" "}
                  {chunkPagination.total}
                </p>
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              {chunks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-[#101010] px-4 py-8 text-center text-sm text-slate-500">
                  {isIndexing
                    ? "Chunks appear here once indexing finishes."
                    : "No indexed chunks are available yet for this source."}
                </div>
              ) : (
                chunks.map((chunk) => {
                  const isLong = chunk.content.length > CHUNK_PREVIEW_LENGTH;
                  const isExpanded = expandedChunks.has(chunk.id);

                  return (
                    <div
                      key={chunk.id}
                      id={`chunk-${chunk.chunkIndex}`}
                      className="scroll-mt-6 rounded-2xl border border-white/10 bg-[#101010] p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-white">
                          Chunk {chunk.chunkIndex + 1}
                        </p>
                        <p className="text-xs text-slate-500">
                          {chunk.tokenCount} tokens
                          {chunk.embeddingModel ? ` · ${chunk.embeddingModel}` : ""}
                        </p>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
                        {isLong && !isExpanded
                          ? `${chunk.content.slice(0, CHUNK_PREVIEW_LENGTH)}...`
                          : chunk.content}
                      </p>
                      {isLong ? (
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => toggleChunk(chunk.id)}
                          className="mt-2 text-xs font-medium text-slate-400 underline-offset-4 transition hover:text-white hover:underline"
                        >
                          {isExpanded ? "Collapse" : "Expand"}
                        </button>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

            {chunkPagination.pageCount > 1 ? (
              <nav
                aria-label="Chunk pages"
                className="mt-4 flex items-center justify-between gap-3 text-sm"
              >
                {chunkPagination.page > 1 ? (
                  <Link
                    href={chunkHref(chunkPagination.page - 1)}
                    scroll={false}
                    className="rounded-lg border border-white/10 bg-[#111111] px-3 py-1.5 text-white transition hover:bg-[#1a1a1a]"
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="rounded-lg border border-white/5 px-3 py-1.5 text-slate-600">
                    Previous
                  </span>
                )}
                <span className="text-xs text-slate-500">
                  Page {chunkPagination.page} of {chunkPagination.pageCount}
                </span>
                {chunkPagination.page < chunkPagination.pageCount ? (
                  <Link
                    href={chunkHref(chunkPagination.page + 1)}
                    scroll={false}
                    className="rounded-lg border border-white/10 bg-[#111111] px-3 py-1.5 text-white transition hover:bg-[#1a1a1a]"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="rounded-lg border border-white/5 px-3 py-1.5 text-slate-600">
                    Next
                  </span>
                )}
              </nav>
            ) : null}
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-[24px] border border-white/10 bg-[#090909] p-5">
            <h2 className="text-lg font-semibold text-white">Source Details</h2>
            <dl className="mt-4 space-y-3 text-sm text-slate-300">
              <DetailRow label="Type">{typeLabels[source.type]}</DetailRow>

              {source.sourceUrl ? (
                <DetailRow label="Source URL">
                  <a
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all underline-offset-4 transition hover:underline"
                  >
                    {source.sourceUrl}
                  </a>
                  <span className="mt-1 block text-xs text-slate-400">
                    {source.crawlMode === "CRAWL"
                      ? `Crawl up to ${source.maxPages} pages · ${source.pageCount} read`
                      : "Single page"}
                  </span>
                </DetailRow>
              ) : null}

              {source.type === "FILE" ? (
                <DetailRow label="File">{fileDetails || "No uploaded file attached"}</DetailRow>
              ) : null}

              <DetailRow label="Linked Agent">
                {source.agent?.name ?? "Unassigned"}
              </DetailRow>
            </dl>
          </section>

          <section className="rounded-[24px] border border-white/10 bg-[#090909] p-5">
            <h2 className="text-lg font-semibold text-white">Vector Index</h2>
            <dl className="mt-4 space-y-3 text-sm text-slate-300">
              <DetailRow label="Vector Status">{statusLabels[source.status]}</DetailRow>
              <DetailRow label="Embedding Model">
                {source.embeddingModel ?? "Not embedded yet"}
                {source.embeddingModel && !isSemanticModel(source.embeddingModel) ? (
                  <span className="mt-1 block text-xs text-amber-200">
                    Offline keyword model: matches words, not meaning.
                  </span>
                ) : null}
              </DetailRow>
              <DetailRow label="Vector Store">
                {source.vectorStore === "pinecone"
                  ? "Pinecone (workspace namespace)"
                  : source.vectorStore === "postgres"
                    ? "PostgreSQL"
                    : "Not stored yet"}
              </DetailRow>
              <DetailRow label="Chunks">{source.chunkCount}</DetailRow>
              {source.type === "URL" ? (
                <DetailRow label="Pages">{source.pageCount}</DetailRow>
              ) : null}
              <DetailRow label="Created">
                {formatDateTime(source.createdAt, timeZone)}
              </DetailRow>
              <DetailRow label="Last Synced">
                {formatDateTime(source.lastSyncedAt, timeZone)}
              </DetailRow>
              <DetailRow label="Vector Indexed">
                {formatDateTime(source.vectorIndexedAt, timeZone)}
              </DetailRow>

              {source.processingError ? (
                <div
                  className={`rounded-2xl border px-4 py-3 ${
                    source.status === "FAILED"
                      ? "border-red-500/20 bg-red-500/10 text-red-100"
                      : "border-amber-500/20 bg-amber-500/10 text-amber-100"
                  }`}
                >
                  <dt className="text-xs uppercase tracking-[0.18em] opacity-80">
                    {source.status === "FAILED" ? "Processing Error" : "Warning"}
                  </dt>
                  <dd className="mt-2 break-words text-sm">{source.processingError}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
