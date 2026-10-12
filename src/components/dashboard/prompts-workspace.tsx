"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PROMPT_BODY_MAX_LENGTH,
  PROMPT_NAME_MAX_LENGTH,
  extractTemplateVariables,
  isKnownTemplateVariable,
  promptTemplateVariables,
  renderPromptTemplate,
  samplePromptValues,
} from "@/src/lib/prompt-templates";

type PromptItem = {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

type PromptsWorkspaceProps = {
  initialPrompts: PromptItem[];
  canEdit: boolean;
};

const PREVIEW_LENGTH = 220;

function truncate(value: string, length: number) {
  const singleLine = value.replace(/\s+/g, " ").trim();

  return singleLine.length > length ? `${singleLine.slice(0, length).trimEnd()}…` : singleLine;
}

export function PromptsWorkspace({ initialPrompts, canEdit }: PromptsWorkspaceProps) {
  const [prompts, setPrompts] = useState(initialPrompts);
  const [search, setSearch] = useState("");
  const [menuOpenId, setMenuOpenId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<PromptItem | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [modalError, setModalError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Dates are only rendered after mount, in the browser's time zone, so the
  // server and client markup always match.
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  useEffect(() => {
    function closeMenu() {
      setMenuOpenId("");
    }

    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  const dateFormatter = useMemo(() => {
    if (!timeZone) {
      return null;
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });
  }, [timeZone]);

  const filteredPrompts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...prompts].sort(
      (first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime(),
    );

    if (!query) {
      return sorted;
    }

    return sorted.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(query) || prompt.body.toLowerCase().includes(query),
    );
  }, [prompts, search]);

  const usedVariables = useMemo(() => extractTemplateVariables(body), [body]);
  const unknownVariables = usedVariables.filter((key) => !isKnownTemplateVariable(key));
  const preview = useMemo(() => renderPromptTemplate(body, samplePromptValues), [body]);

  function openCreateModal() {
    setEditingPrompt(null);
    setName("");
    setBody("");
    setModalError("");
    setError("");
    setSuccess("");
    setModalOpen(true);
  }

  function openEditModal(prompt: PromptItem) {
    setEditingPrompt(prompt);
    setName(prompt.name);
    setBody(prompt.body);
    setModalError("");
    setError("");
    setSuccess("");
    setMenuOpenId("");
    setModalOpen(true);
  }

  function closeModal() {
    if (!isSaving) {
      setModalOpen(false);
    }
  }

  function insertVariable(key: string) {
    const token = `{{${key}}}`;
    const textarea = bodyRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    const nextBody = `${body.slice(0, start)}${token}${body.slice(end)}`;

    setBody(nextBody);

    // Put the cursor right after the inserted variable.
    window.requestAnimationFrame(() => {
      if (!textarea) {
        return;
      }

      const cursor = start + token.length;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  async function handleSave() {
    const trimmedName = name.trim();
    const trimmedBody = body.trim();

    if (!trimmedName) {
      setModalError("Give the prompt a name so your team can find it.");
      return;
    }

    if (!trimmedBody) {
      setModalError("The prompt body is empty. Write the instructions the AI should follow.");
      return;
    }

    if (trimmedBody.length > PROMPT_BODY_MAX_LENGTH) {
      setModalError(
        `The prompt body is too long (${trimmedBody.length} characters). Keep it under ${PROMPT_BODY_MAX_LENGTH} characters.`,
      );
      return;
    }

    setModalError("");
    setSuccess("");
    setIsSaving(true);

    try {
      const response = await fetch(
        editingPrompt ? `/api/prompts/${editingPrompt.id}` : "/api/prompts",
        {
          method: editingPrompt ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: trimmedName, body: trimmedBody }),
        },
      );

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        prompt?: PromptItem;
      };

      if (!response.ok || !data.prompt) {
        setModalError(
          data.error ?? "We couldn't save the prompt. Check your connection and try again.",
        );
        return;
      }

      const savedPrompt: PromptItem = {
        ...data.prompt,
        createdAt: new Date(data.prompt.createdAt).toISOString(),
        updatedAt: new Date(data.prompt.updatedAt).toISOString(),
      };

      setPrompts((current) => {
        const existingIndex = current.findIndex((item) => item.id === savedPrompt.id);

        if (existingIndex === -1) {
          return [savedPrompt, ...current];
        }

        const next = [...current];
        next[existingIndex] = savedPrompt;
        return next;
      });

      setSuccess(editingPrompt ? "Prompt updated successfully." : "Prompt created successfully.");
      setModalOpen(false);
    } catch {
      setModalError("Something went wrong while saving the prompt. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(prompt: PromptItem) {
    setMenuOpenId("");

    if (!window.confirm(`Delete the prompt "${prompt.name}"? This action cannot be undone.`)) {
      return;
    }

    setError("");
    setSuccess("");
    setDeletingId(prompt.id);

    try {
      const response = await fetch(`/api/prompts/${prompt.id}`, {
        method: "DELETE",
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "We couldn't delete the prompt. Refresh the page and try again.");
        return;
      }

      setPrompts((current) => current.filter((item) => item.id !== prompt.id));
      setSuccess("Prompt deleted.");
    } catch {
      setError("Something went wrong while deleting the prompt. Check your connection and try again.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
            Prompts
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-400">
            Reusable instructions for AI drafts. Use variables like{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5 text-slate-200">{"{{ticket}}"}</code>{" "}
            or{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5 text-slate-200">
              {"{{customer_name}}"}
            </code>{" "}
            and they are filled with live ticket data when a draft is generated.
          </p>
        </div>

        {canEdit ? (
          <button
            type="button"
            onClick={openCreateModal}
            className="pressable inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
          >
            + New Prompt
          </button>
        ) : null}
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
        <p className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </p>
      ) : null}

      {!canEdit ? (
        <p className="mt-5 rounded-xl border border-white/10 bg-[#0a0a0a] px-4 py-3 text-sm text-slate-400">
          You can use these prompts when drafting replies. Ask a manager or admin to add or
          change prompts.
        </p>
      ) : null}

      <div className="mt-6 inline-flex h-11 w-full max-w-md items-center rounded-lg border border-white/10 bg-[#111111] px-3">
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3-3" />
        </svg>
        <label htmlFor="prompts-search" className="sr-only">
          Search prompts
        </label>
        <input
          id="prompts-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or content"
          className="ml-3 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
        />
      </div>

      {filteredPrompts.length === 0 ? (
        <div className="mt-6 flex min-h-[260px] flex-col items-center justify-center rounded-[22px] border border-white/10 bg-[#0a0a0a] px-6 py-16 text-center">
          <svg
            viewBox="0 0 24 24"
            className="h-10 w-10 text-slate-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M5 4h14v16H5z" />
            <path d="M9 9h6" />
            <path d="M9 13h6" />
            <path d="M9 17h3" />
          </svg>
          {prompts.length === 0 ? (
            <>
              <p className="mt-4 text-xl text-slate-300">No prompts yet</p>
              <p className="mt-2 max-w-md text-sm text-slate-500">
                Prompts let your team generate consistent AI drafts, for example a polite
                resolution reply or a ticket summary.
              </p>
              {canEdit ? (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="pressable mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
                >
                  + New Prompt
                </button>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-4 text-xl text-slate-300">No prompts match “{search.trim()}”</p>
              <p className="mt-2 text-sm text-slate-500">
                Try another word from the prompt name or content.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredPrompts.map((prompt) => {
            const promptVariables = extractTemplateVariables(prompt.body);

            return (
              <article
                key={prompt.id}
                className="flex flex-col rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-white" title={prompt.name}>
                      {prompt.name}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Created {dateFormatter ? dateFormatter.format(new Date(prompt.createdAt)) : "…"}
                    </p>
                  </div>

                  {canEdit ? (
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        aria-label={`Actions for ${prompt.name}`}
                        aria-haspopup="menu"
                        aria-expanded={menuOpenId === prompt.id}
                        disabled={deletingId === prompt.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuOpenId((current) => (current === prompt.id ? "" : prompt.id));
                        }}
                        className="pressable inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-white transition hover:bg-[#1a1a1a] disabled:opacity-50"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                          <circle cx="12" cy="5" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="12" cy="19" r="1.8" />
                        </svg>
                      </button>

                      {menuOpenId === prompt.id ? (
                        <div
                          role="menu"
                          className="absolute right-0 top-11 z-20 min-w-[150px] rounded-xl border border-white/10 bg-[#0f0f0f] p-1.5 shadow-[0_14px_32px_rgba(0,0,0,0.45)]"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => openEditModal(prompt)}
                            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => void handleDelete(prompt)}
                            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-200 transition hover:bg-red-500/10"
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <p className="mt-4 flex-1 break-words text-sm leading-6 text-slate-300">
                  {truncate(prompt.body, PREVIEW_LENGTH)}
                </p>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs text-slate-500">
                  <span>{prompt.body.length.toLocaleString("en-US")} characters</span>
                  <span className="truncate" title={promptVariables.map((key) => `{{${key}}}`).join(" ")}>
                    {promptVariables.length > 0
                      ? `${promptVariables.length} variable${promptVariables.length > 1 ? "s" : ""}`
                      : "No variables"}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {canEdit ? (
        <div
          inert={!modalOpen}
          className={`fixed inset-0 z-50 transition ${
            modalOpen ? "pointer-events-auto" : "pointer-events-none"
          }`}
        >
          <button
            type="button"
            aria-label="Close prompt modal"
            onClick={closeModal}
            className={`absolute inset-0 bg-black/60 transition duration-300 ${
              modalOpen ? "opacity-100" : "opacity-0"
            }`}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-modal-title"
            className={`absolute left-1/2 top-1/2 max-h-[94vh] w-[min(94vw,980px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[24px] border border-white/10 bg-[#080808] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] transition duration-300 ${
              modalOpen ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="prompt-modal-title" className="text-[2rem] font-semibold text-white">
                {editingPrompt ? "Edit Prompt" : "New Prompt"}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="pressable rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-sm text-slate-300 transition hover:bg-[#1a1a1a]"
              >
                X
              </button>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="prompt-name" className="block text-sm font-medium text-white">
                  Name
                </label>
                <span className="text-xs text-slate-500">
                  {name.trim().length}/{PROMPT_NAME_MAX_LENGTH}
                </span>
              </div>
              <input
                id="prompt-name"
                type="text"
                value={name}
                maxLength={PROMPT_NAME_MAX_LENGTH}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Polite resolution reply"
                className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
              />
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="min-w-0">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="prompt-body" className="block text-sm font-medium text-white">
                    Prompt
                  </label>
                  <span
                    className={`text-xs ${
                      body.length > PROMPT_BODY_MAX_LENGTH ? "text-red-300" : "text-slate-500"
                    }`}
                  >
                    {body.length.toLocaleString("en-US")}/
                    {PROMPT_BODY_MAX_LENGTH.toLocaleString("en-US")} characters
                  </span>
                </div>
                <textarea
                  id="prompt-body"
                  ref={bodyRef}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder={"Write the instructions for the AI. For example:\nReply politely to {{customer_name}} about:\n{{ticket}}"}
                  className="min-h-[280px] w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 font-mono text-sm leading-6 text-white outline-none transition focus:border-white"
                />

                <div className="mt-3">
                  <p id="prompt-variables-help" className="text-sm font-medium text-white">
                    Variables
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Click a variable to insert it at the cursor. It is replaced with live ticket
                    data when a draft is generated.
                  </p>
                  <div
                    className="mt-2 flex flex-wrap gap-2"
                    role="group"
                    aria-labelledby="prompt-variables-help"
                  >
                    {promptTemplateVariables.map((variable) => (
                      <button
                        key={variable.key}
                        type="button"
                        onClick={() => insertVariable(variable.key)}
                        title={variable.description}
                        aria-label={`Insert {{${variable.key}}}: ${variable.description}`}
                        className={`pressable rounded-lg border px-2.5 py-1 font-mono text-xs transition ${
                          usedVariables.includes(variable.key)
                            ? "border-white/40 bg-white/10 text-white"
                            : "border-white/10 bg-[#111111] text-slate-300 hover:bg-[#1a1a1a]"
                        }`}
                      >
                        {`{{${variable.key}}}`}
                      </button>
                    ))}
                  </div>
                  {unknownVariables.length > 0 ? (
                    <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      Unknown variable{unknownVariables.length > 1 ? "s" : ""}:{" "}
                      {unknownVariables.map((key) => `{{${key}}}`).join(", ")}. These are sent to
                      the AI as-is. Check the spelling or pick one from the list above.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="min-w-0">
                <p className="mb-2 text-sm font-medium text-white">Preview with sample data</p>
                <div className="min-h-[280px] whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-[#0c0c0c] px-4 py-3 text-sm leading-6 text-slate-300">
                  {preview.trim() ? (
                    preview
                  ) : (
                    <span className="text-slate-500">
                      Start typing to see how the prompt will look with real ticket data.
                    </span>
                  )}
                </div>
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
                onClick={closeModal}
                disabled={isSaving}
                className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleSave()}
                className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
              >
                {isSaving ? "Saving..." : editingPrompt ? "Update Prompt" : "Create Prompt"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
