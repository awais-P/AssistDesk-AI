"use client";

import { useMemo, useState } from "react";

type CannedResponseItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

type CannedResponsesWorkspaceProps = {
  initialResponses: CannedResponseItem[];
  createdByName: string;
};

const variables = [
  { label: "Ticket #", value: "{{ticket.id}}" },
  { label: "Subject", value: "{{ticket.subject}}" },
  { label: "Requester Name", value: "{{requester.name}}" },
  { label: "Requester Email", value: "{{requester.email}}" },
  { label: "Status", value: "{{ticket.status}}" },
  { label: "Priority", value: "{{ticket.priority}}" },
  { label: "Created Date", value: "{{ticket.created_at}}" },
];

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, "");
}

export function CannedResponsesWorkspace({
  initialResponses,
  createdByName,
}: CannedResponsesWorkspaceProps) {
  const [responses, setResponses] = useState(initialResponses);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingResponse, setEditingResponse] = useState<CannedResponseItem | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [showVariables, setShowVariables] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const sortedResponses = useMemo(() => {
    return [...responses].sort((first, second) => {
      return new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
    });
  }, [responses]);

  function openCreateModal() {
    setEditingResponse(null);
    setTitle("");
    setBody("");
    setShowVariables(false);
    setError("");
    setSuccess("");
    setModalOpen(true);
  }

  function openEditModal(response: CannedResponseItem) {
    setEditingResponse(response);
    setTitle(response.title);
    setBody(response.body);
    setShowVariables(false);
    setError("");
    setSuccess("");
    setModalOpen(true);
  }

  function insertVariable(variable: string) {
    setBody((current) => `${current}${current ? " " : ""}${variable}`);
    setShowVariables(false);
  }

  async function handleSave() {
    setError("");
    setSuccess("");
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

      const data = (await response.json()) as {
        error?: string;
        cannedResponse?: CannedResponseItem;
      };

      if (!response.ok || !data.cannedResponse) {
        setError(data.error ?? "Unable to save the response.");
        setIsSaving(false);
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
      setError("Something went wrong while saving the response.");
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

    const response = await fetch(`/api/canned-responses/${id}`, {
      method: "DELETE",
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to delete the response.");
      return;
    }

    setResponses((current) => current.filter((item) => item.id !== id));
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
            inquiries. Use variables like {"{ticket_id}"} to personalize your
            messages.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
        >
          + Create Response
        </button>
      </div>

      {error ? (
        <p className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </p>
      ) : null}

      <div className="mt-6 rounded-[22px] border border-white/10 bg-[#0a0a0a]">
        <div className="grid grid-cols-[0.8fr_3fr_1.2fr_1.3fr_0.55fr] gap-4 border-b border-white/10 px-4 py-5 text-sm font-semibold text-white">
          <span>Name</span>
          <span>Content</span>
          <span>Created By</span>
          <span>Created At</span>
          <span>Actions</span>
        </div>

        {sortedResponses.map((response) => (
          <div
            key={response.id}
            className="grid grid-cols-[0.8fr_3fr_1.2fr_1.3fr_0.55fr] gap-4 border-b border-white/10 px-4 py-5 last:border-b-0"
          >
            <div className="font-semibold text-white">{response.title}</div>
            <div className="text-white">{response.body}</div>
            <div className="text-white">{createdByName}</div>
            <div className="text-white">{formatDateTime(response.createdAt)}</div>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => openEditModal(response)}
                className="pressable transition hover:text-slate-300"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="m4 20 4.5-1 9-9-3.5-3.5-9 9L4 20Z" />
                  <path d="m13 6 3.5 3.5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(response.id)}
                className="pressable text-red-400 transition hover:text-red-300"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
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

      <div
        className={`fixed inset-0 z-50 transition ${
          modalOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <button
          type="button"
          aria-label="Close response modal"
          onClick={() => setModalOpen(false)}
          className={`absolute inset-0 bg-black/60 transition duration-300 ${
            modalOpen ? "opacity-100" : "opacity-0"
          }`}
        />

        <div
          className={`absolute left-1/2 top-1/2 w-[min(92vw,700px)] -translate-x-1/2 -translate-y-1/2 rounded-[24px] border border-white/10 bg-[#080808] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] transition duration-300 ${
            modalOpen ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-[2rem] font-semibold text-white">
              {editingResponse ? "Edit Response" : "Create Response"}
            </h2>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="pressable rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-sm text-slate-300 transition hover:bg-[#1a1a1a]"
            >
              X
            </button>
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-sm font-medium text-white">
              Name
            </label>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
            />
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-sm font-medium text-white">
              Content
            </label>
            <div className="rounded-xl border border-white/10 bg-[#0c0c0c]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="flex items-center gap-4 text-slate-300">
                  <button type="button" className="text-lg font-bold">
                    B
                  </button>
                  <button type="button" className="text-lg italic">
                    I
                  </button>
                  <button type="button" className="text-sm">
                    •
                  </button>
                  <button type="button" className="text-sm">
                    1.
                  </button>
                  <button type="button" className="text-sm">
                    🔗
                  </button>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowVariables((current) => !current)}
                    className="pressable rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#232323]"
                  >
                    Variables
                  </button>

                  {showVariables ? (
                    <div className="absolute right-0 top-12 z-20 min-w-[190px] rounded-xl border border-white/10 bg-[#141414] p-2 shadow-[0_14px_32px_rgba(0,0,0,0.45)]">
                      {variables.map((variable) => (
                        <button
                          key={variable.value}
                          type="button"
                          onClick={() => insertVariable(variable.value)}
                          className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white transition hover:bg-white/5"
                        >
                          {variable.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-[190px] w-full bg-transparent px-4 py-4 text-sm leading-6 text-white outline-none"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
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
    </div>
  );
}
