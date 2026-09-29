"use client";

import { useMemo, useRef, useState } from "react";
import {
  applyMarkdownFormat,
  cannedVariables,
  cannedVariableToken,
  type MarkdownFormat,
} from "@/src/lib/canned-variables";

type CannedResponseItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

type CannedResponsesWorkspaceProps = {
  initialResponses: CannedResponseItem[];
  timeZone: string;
};

const formatButtons: Array<{ format: MarkdownFormat; label: string; ariaLabel: string; className: string }> = [
  { format: "bold", label: "B", ariaLabel: "Bold", className: "text-lg font-bold" },
  { format: "italic", label: "I", ariaLabel: "Italic", className: "text-lg italic" },
  { format: "bullet", label: "•", ariaLabel: "Bulleted list", className: "text-sm" },
  { format: "numbered", label: "1.", ariaLabel: "Numbered list", className: "text-sm" },
  { format: "link", label: "Link", ariaLabel: "Insert link", className: "text-sm" },
];

// Formatted in the workspace time zone so server and client output match (UI-19).
function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

export function CannedResponsesWorkspace({
  initialResponses,
  timeZone,
}: CannedResponsesWorkspaceProps) {
  const [responses, setResponses] = useState(initialResponses);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingResponse, setEditingResponse] = useState<CannedResponseItem | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [showVariables, setShowVariables] = useState(false);
  const [modalError, setModalError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const sortedResponses = useMemo(() => {
    return [...responses].sort((first, second) => {
      return new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
    });
  }, [responses]);

  function openModal(response: CannedResponseItem | null) {
    setEditingResponse(response);
    setTitle(response?.title ?? "");
    setBody(response?.body ?? "");
    setShowVariables(false);
    setModalError("");
    setError("");
    setSuccess("");
    setModalOpen(true);
  }

  function closeModal() {
    if (isSaving) {
      return;
    }

    setModalOpen(false);
    setModalError("");
  }

  function restoreSelection(start: number, end: number) {
    window.requestAnimationFrame(() => {
      bodyRef.current?.focus();
      bodyRef.current?.setSelectionRange(start, end);
    });
  }

  function formatBody(format: MarkdownFormat) {
    const textarea = bodyRef.current;
    const result = applyMarkdownFormat(
      body,
      textarea?.selectionStart ?? body.length,
      textarea?.selectionEnd ?? body.length,
      format,
    );

    setBody(result.value);
    restoreSelection(result.selectionStart, result.selectionEnd);
  }

  function insertVariable(variable: string) {
    const textarea = bodyRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    const cursor = start + variable.length;

    setBody(`${body.slice(0, start)}${variable}${body.slice(end)}`);
    setShowVariables(false);
    restoreSelection(cursor, cursor);
  }

  async function handleSave() {
    if (isSaving) {
      return;
    }

    setModalError("");
    setSuccess("");

    if (!title.trim() || !body.trim()) {
      setModalError("Give the response a name and some content.");
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/canned-responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: editingResponse?.id,
          title,
          body,
        }),
      });

      const data = await readJson<{
        error?: string;
        cannedResponse?: CannedResponseItem;
      }>(response);

      if (!response.ok || !data.cannedResponse) {
        setModalError(data.error ?? "Unable to save the response.");
        return;
      }

      const nextItem = {
        ...data.cannedResponse,
        createdAt: new Date(data.cannedResponse.createdAt).toISOString(),
      };

      setResponses((current) => {
        const existingIndex = current.findIndex((item) => item.id === nextItem.id);

        if (existingIndex === -1) {
          return [...current, nextItem];
        }

        const next = [...current];
        next[existingIndex] = nextItem;
        return next;
      });

      setSuccess(
        editingResponse
          ? "Response updated successfully."
          : "Response created successfully.",
      );
      setModalOpen(false);
    } catch {
      setModalError("Something went wrong while saving the response. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const shouldDelete = window.confirm(
      "Delete this canned response? This action cannot be undone.",
    );

    if (!shouldDelete) {
      return;
    }

    setError("");
    setSuccess("");
    setDeletingId(id);

    try {
      const response = await fetch(`/api/canned-responses/${id}`, {
        method: "DELETE",
      });

      const data = await readJson<{ error?: string }>(response);

      if (!response.ok) {
        setError(data.error ?? "Unable to delete the response.");
        return;
      }

      setResponses((current) => current.filter((item) => item.id !== id));
      setSuccess("Response deleted.");
    } catch {
      setError("Something went wrong while deleting the response.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
            Canned Responses
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-400">
            Create and manage pre-written responses for common customer
            inquiries. Use variables like {cannedVariableToken("customer_name")} or{" "}
            {cannedVariableToken("ticket_number")} to personalize your messages;
            they are filled in when you insert the response on a ticket.
          </p>
        </div>

        <button
          type="button"
          onClick={() => openModal(null)}
          className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
        >
          + Create Response
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </p>
      ) : null}

      {success ? (
        <p
          role="status"
          className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
        >
          {success}
        </p>
      ) : null}

      {sortedResponses.length === 0 ? (
        <div className="mt-6 rounded-[22px] border border-dashed border-white/10 bg-[#0a0a0a] px-6 py-12 text-center">
          <p className="text-base font-semibold text-white">No canned responses yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            Save replies you send often, like a password reset guide or a refund
            policy, and insert them into any ticket with one click.
          </p>
          <button
            type="button"
            onClick={() => openModal(null)}
            className="pressable mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
          >
            Create your first response
          </button>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-[22px] border border-white/10 bg-[#0a0a0a]">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[1fr_3fr_1.3fr_0.55fr] gap-4 border-b border-white/10 px-4 py-5 text-sm font-semibold text-white">
              <span>Name</span>
              <span>Content</span>
              <span>Created At</span>
              <span>Actions</span>
            </div>

            {sortedResponses.map((response) => (
              <div
                key={response.id}
                className="grid grid-cols-[1fr_3fr_1.3fr_0.55fr] gap-4 border-b border-white/10 px-4 py-5 last:border-b-0"
              >
                <div className="break-words font-semibold text-white">{response.title}</div>
                <div className="line-clamp-3 break-words text-slate-200">
                  {stripHtml(response.body)}
                </div>
                <div className="text-white">
                  {formatDateTime(response.createdAt, timeZone)}
                </div>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    aria-label={`Edit ${response.title}`}
                    title="Edit"
                    onClick={() => openModal(response)}
                    className="pressable text-white transition hover:text-slate-300"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
                    >
                      <path d="m4 20 4.5-1 9-9-3.5-3.5-9 9L4 20Z" />
                      <path d="m13 6 3.5 3.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${response.title}`}
                    title="Delete"
                    disabled={deletingId === response.id}
                    onClick={() => void handleDelete(response.id)}
                    className="pressable text-red-400 transition hover:text-red-300 disabled:opacity-50"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
                    >
                      <path d="M5 7h14" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M7 7l1 12h8l1-12" />
                      <path d="M9 7V5h6v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closeModal();
            }
          }}
        >
          <button
            type="button"
            aria-label="Close response modal"
            onClick={closeModal}
            className="absolute inset-0 bg-black/60"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="canned-response-modal-title"
            className="absolute left-1/2 top-1/2 max-h-[92vh] w-[min(92vw,700px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[24px] border border-white/10 bg-[#080808] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-start justify-between gap-4">
              <h2
                id="canned-response-modal-title"
                className="text-[2rem] font-semibold text-white"
              >
                {editingResponse ? "Edit Response" : "Create Response"}
              </h2>
              <button
                type="button"
                aria-label="Close"
                disabled={isSaving}
                onClick={closeModal}
                className="pressable rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-sm text-slate-300 transition hover:bg-[#1a1a1a] disabled:opacity-60"
              >
                X
              </button>
            </div>

            <div className="mt-5">
              <label
                htmlFor="canned-response-title"
                className="mb-2 block text-sm font-medium text-white"
              >
                Name
              </label>
              <input
                id="canned-response-title"
                type="text"
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
              />
            </div>

            <div className="mt-5">
              <label
                htmlFor="canned-response-body"
                className="mb-2 block text-sm font-medium text-white"
              >
                Content
              </label>
              <div className="rounded-xl border border-white/10 bg-[#0c0c0c]">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <div className="flex items-center gap-4 text-slate-300">
                    {formatButtons.map((item) => (
                      <button
                        key={item.format}
                        type="button"
                        aria-label={item.ariaLabel}
                        title={item.ariaLabel}
                        onClick={() => formatBody(item.format)}
                        className={`transition hover:text-white ${item.className}`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      aria-haspopup="true"
                      aria-expanded={showVariables}
                      onClick={() => setShowVariables((current) => !current)}
                      className="pressable rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#232323]"
                    >
                      Variables
                    </button>

                    {showVariables ? (
                      <div className="absolute right-0 top-12 z-20 min-w-[240px] rounded-xl border border-white/10 bg-[#141414] p-2 shadow-[0_14px_32px_rgba(0,0,0,0.45)]">
                        {cannedVariables.map((variable) => (
                          <button
                            key={variable.key}
                            type="button"
                            onClick={() => insertVariable(cannedVariableToken(variable.key))}
                            className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-white transition hover:bg-white/5"
                          >
                            <span>{variable.label}</span>
                            <code className="text-xs text-slate-500">
                              {cannedVariableToken(variable.key)}
                            </code>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <textarea
                  id="canned-response-body"
                  ref={bodyRef}
                  maxLength={10000}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  className="min-h-[190px] w-full bg-transparent px-4 py-4 text-sm leading-6 text-white outline-none"
                />
              </div>
            </div>

            {modalError ? (
              <p
                role="alert"
                className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
              >
                {modalError}
              </p>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={isSaving}
                onClick={closeModal}
                className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleSave()}
                className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
              >
                {isSaving ? "Saving..." : editingResponse ? "Update Response" : "Create Response"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
