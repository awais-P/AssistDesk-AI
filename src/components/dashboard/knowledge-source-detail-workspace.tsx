"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type KnowledgeSourceDetailProps = {
  source: {
    id: string;
    title: string;
    type: "FILE" | "URL" | "TEXT";
    status: "PENDING" | "PROCESSING" | "SYNCED" | "FAILED" | "DELETED";
    sourceUrl: string | null;
    fileName: string | null;
    mimeType: string | null;
    storagePath: string | null;
    fileSize: number | null;
    rawText: string | null;
    chunkCount: number;
    vectorIndexedAt: string | null;
    processingError: string | null;
    createdAt: string;
    updatedAt: string;
    lastSyncedAt: string | null;
    agent: { id: string; name: string } | null;
    chunks: Array<{
      id: string;
      chunkIndex: number;
      content: string;
      tokenCount: number;
      updatedAt: string;
    }>;
  };
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFileSize(size: number | null) {
  if (!size) return "No file uploaded";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function statusPillClass(status: KnowledgeSourceDetailProps["source"]["status"]) {
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

export function KnowledgeSourceDetailWorkspace({
  source,
}: KnowledgeSourceDetailProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);

  useEffect(() => {
    if (source.status !== "PROCESSING") {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, 4000);

    return () => window.clearInterval(interval);
  }, [router, source.status]);

  async function handleAction(
    action: "PROCESSING" | "SYNCED" | "PENDING" | "DELETE",
  ) {
    setError("");
    setActiveAction(action);

    try {
      const response =
        action === "DELETE"
          ? await fetch(`/api/knowledge-sources/${source.id}`, {
              method: "DELETE",
            })
          : await fetch(`/api/knowledge-sources/${source.id}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ status: action }),
            });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to update this source.");
      }

      if (action === "DELETE") {
        router.push("/dashboard/knowledge-base");
        router.refresh();
        return;
      }

      router.refresh();
    } catch (thrownError) {
      setError(
        thrownError instanceof Error
          ? thrownError.message
          : "Unable to update this source.",
      );
    } finally {
      setActiveAction(null);
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link
            href="/dashboard/knowledge-base"
            className="text-sm text-slate-400 transition hover:text-white"
          >
            ← Back to Knowledge Base
          </Link>
          <h1 className="mt-3 text-3xl font-semibold text-white">
            {source.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <span className="rounded-full border border-white/10 bg-[#121212] px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-300">
              {source.type.toLowerCase()}
            </span>
            <span
              className={`rounded-full border px-3 py-1 text-xs capitalize ${statusPillClass(source.status)}`}
            >
              {source.status.toLowerCase().replaceAll("_", " ")}
            </span>
            <span>{source.chunkCount} indexed chunks</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={activeAction !== null}
            onClick={() => {
              void handleAction("PROCESSING");
            }}
            className="rounded-xl border border-white/10 bg-[#151515] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1e1e1e] disabled:opacity-50"
          >
            Process
          </button>
          <button
            type="button"
            disabled={activeAction !== null}
            onClick={() => {
              void handleAction("SYNCED");
            }}
            className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-50"
          >
            Sync
          </button>
          <button
            type="button"
            disabled={activeAction !== null}
            onClick={() => {
              void handleAction("PENDING");
            }}
            className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-50"
          >
            Retry
          </button>
          <button
            type="button"
            disabled={activeAction !== null}
            onClick={() => {
              void handleAction("DELETE");
            }}
            className="rounded-xl border border-white/10 bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#262626] disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(320px,1fr)]">
        <div className="space-y-4">
          <section className="rounded-[24px] border border-white/10 bg-[#090909] p-5">
            <h2 className="text-lg font-semibold text-white">Extracted Content</h2>
            <p className="mt-2 text-sm text-slate-400">
              This is the normalized text currently being used by the retrieval
              layer for this source.
            </p>
            <div className="mt-4 rounded-2xl border border-white/10 bg-[#111111] p-4">
              <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
                {source.rawText || "No readable content has been extracted yet."}
              </pre>
            </div>
          </section>

          <section className="rounded-[24px] border border-white/10 bg-[#090909] p-5">
            <h2 className="text-lg font-semibold text-white">Indexed Chunks</h2>
            <p className="mt-2 text-sm text-slate-400">
              Chunk previews generated during background processing. These chunks
              are used by the current vector-style retrieval layer.
            </p>

            <div className="mt-4 space-y-3">
              {source.chunks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-[#101010] px-4 py-8 text-center text-sm text-slate-500">
                  No indexed chunks are available yet for this source.
                </div>
              ) : (
                source.chunks.map((chunk) => (
                  <div
                    key={chunk.id}
                    className="rounded-2xl border border-white/10 bg-[#101010] p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white">
                        Chunk {chunk.chunkIndex + 1}
                      </p>
                      <p className="text-xs text-slate-500">
                        {chunk.tokenCount} tokens • {formatDateTime(chunk.updatedAt)}
                      </p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {chunk.content}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-[24px] border border-white/10 bg-[#090909] p-5">
            <h2 className="text-lg font-semibold text-white">Source Details</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/10 bg-[#101010] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Linked Agent
                </p>
                <p className="mt-2 text-white">
                  {source.agent?.name ?? "Unassigned"}
                </p>
              </div>

              {source.sourceUrl ? (
                <div className="rounded-2xl border border-white/10 bg-[#101010] px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Source URL
                  </p>
                  <a
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block break-all text-white underline-offset-4 transition hover:underline"
                  >
                    {source.sourceUrl}
                  </a>
                </div>
              ) : null}

              <div className="rounded-2xl border border-white/10 bg-[#101010] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  File Information
                </p>
                <p className="mt-2 text-white">
                  {source.fileName ?? "No uploaded file attached"}
                </p>
                <p className="mt-1 text-slate-400">
                  {[source.mimeType, formatFileSize(source.fileSize)]
                    .filter(Boolean)
                    .join(" • ")}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[24px] border border-white/10 bg-[#090909] p-5">
            <h2 className="text-lg font-semibold text-white">Processing State</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/10 bg-[#101010] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Last Synced
                </p>
                <p className="mt-2 text-white">{formatDateTime(source.lastSyncedAt)}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#101010] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Vector Indexed
                </p>
                <p className="mt-2 text-white">
                  {formatDateTime(source.vectorIndexedAt)}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#101010] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Created
                </p>
                <p className="mt-2 text-white">{formatDateTime(source.createdAt)}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#101010] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Last Updated
                </p>
                <p className="mt-2 text-white">{formatDateTime(source.updatedAt)}</p>
              </div>

              {source.processingError ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-100">
                  <p className="text-xs uppercase tracking-[0.18em] text-red-200/80">
                    Processing Error
                  </p>
                  <p className="mt-2 text-sm">{source.processingError}</p>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
