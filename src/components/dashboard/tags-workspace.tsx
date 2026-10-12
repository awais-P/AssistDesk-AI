"use client";

import { useState } from "react";

type TagItem = {
  id: string;
  name: string;
  color: string;
  ticketCount: number;
};

type TagsWorkspaceProps = {
  initialTags: TagItem[];
  canDelete: boolean;
};

const colorOptions = [
  "#f97316",
  "#facc15",
  "#22c55e",
  "#4f8cff",
  "#8b5cf6",
  "#ec4899",
];

const TAG_NAME_MAX_LENGTH = 40;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function TagsWorkspace({ initialTags, canDelete }: TagsWorkspaceProps) {
  const [tags, setTags] = useState(initialTags);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagItem | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(colorOptions[0]);
  const [modalError, setModalError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");

  function openCreateModal() {
    setEditingTag(null);
    setName("");
    setColor(colorOptions[0]);
    setModalError("");
    setError("");
    setSuccess("");
    setModalOpen(true);
  }

  function openEditModal(tag: TagItem) {
    setEditingTag(tag);
    setName(tag.name);
    setColor(tag.color);
    setModalError("");
    setError("");
    setSuccess("");
    setModalOpen(true);
  }

  function closeModal() {
    if (!isSaving) {
      setModalOpen(false);
    }
  }

  async function handleSave() {
    const trimmedName = name.trim();

    if (!trimmedName) {
      setModalError("Enter a tag name, for example \"Billing\" or \"Bug\".");
      return;
    }

    if (!HEX_COLOR_PATTERN.test(color)) {
      setModalError("Pick a tag color from the palette.");
      return;
    }

    setModalError("");
    setSuccess("");
    setIsSaving(true);

    try {
      const response = await fetch("/api/tags", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: editingTag?.id,
          name: trimmedName,
          color,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        tag?: Omit<TagItem, "ticketCount">;
      };

      if (!response.ok || !data.tag) {
        setModalError(
          data.error ??
            "We couldn't save the tag. Check your connection and try again.",
        );
        return;
      }

      const savedTag = data.tag;

      setTags((current) => {
        const existingIndex = current.findIndex((item) => item.id === savedTag.id);

        if (existingIndex === -1) {
          return [...current, { ...savedTag, ticketCount: 0 }];
        }

        const next = [...current];
        next[existingIndex] = { ...next[existingIndex], ...savedTag };
        return next;
      });

      setSuccess(editingTag ? "Tag updated successfully." : "Tag created successfully.");
      setModalOpen(false);
    } catch {
      setModalError("Something went wrong while saving the tag. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(tag: TagItem) {
    const shouldDelete = window.confirm(
      tag.ticketCount > 0
        ? `Delete "${tag.name}"? It will be removed from ${tag.ticketCount} ticket(s). This action cannot be undone.`
        : `Delete "${tag.name}"? This action cannot be undone.`,
    );

    if (!shouldDelete) {
      return;
    }

    setError("");
    setSuccess("");
    setDeletingId(tag.id);

    try {
      const response = await fetch(`/api/tags/${tag.id}`, {
        method: "DELETE",
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "We couldn't delete the tag. Refresh the page and try again.");
        return;
      }

      setTags((current) => current.filter((item) => item.id !== tag.id));
      setSuccess("Tag deleted.");
    } catch {
      setError("Something went wrong while deleting the tag. Check your connection and try again.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
            Tags
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Manage tags to categorize and organize your tickets.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
        >
          + Create Tag
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
        <p className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </p>
      ) : null}

      <div className="mt-6 rounded-[22px] border border-white/10 bg-[#0a0a0a]">
        {tags.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-16 text-center">
            <svg
              viewBox="0 0 24 24"
              className="h-10 w-10 text-slate-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M3 12V4h8l9 9-8 8-9-9Z" />
              <circle cx="7.5" cy="8.5" r="1.5" />
            </svg>
            <p className="mt-4 text-xl text-slate-300">No tags yet</p>
            <p className="mt-2 max-w-md text-sm text-slate-500">
              Tags help your team group tickets by topic, like Billing, Bug or
              Feature request. Create your first tag to start organizing tickets.
            </p>
            <button
              type="button"
              onClick={openCreateModal}
              className="pressable mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
            >
              + Create Tag
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_120px_110px] gap-4 border-b border-white/10 px-4 py-5 text-sm font-semibold text-white">
              <span>Tag</span>
              <span>Tickets</span>
              <span>Actions</span>
            </div>

            {tags.map((tag) => (
              <div
                key={tag.id}
                className="grid grid-cols-[1fr_120px_110px] gap-4 border-b border-white/10 px-4 py-5 last:border-b-0"
              >
                <div className="flex min-w-0 items-center">
                  <span
                    className="truncate rounded-lg border px-3 py-1 text-sm"
                    style={{
                      borderColor: tag.color,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                </div>

                <div className="flex items-center text-sm text-slate-300">
                  {tag.ticketCount}
                </div>

                <div className="flex items-center gap-4 text-white">
                  <button
                    type="button"
                    onClick={() => openEditModal(tag)}
                    aria-label={`Edit tag ${tag.name}`}
                    className="pressable transition hover:text-slate-300"
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
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => void handleDelete(tag)}
                      disabled={deletingId === tag.id}
                      aria-label={`Delete tag ${tag.name}`}
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
                  ) : null}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div
        inert={!modalOpen}
        className={`fixed inset-0 z-50 transition ${
          modalOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <button
          type="button"
          aria-label="Close tag modal"
          onClick={closeModal}
          className={`absolute inset-0 bg-black/60 transition duration-300 ${
            modalOpen ? "opacity-100" : "opacity-0"
          }`}
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tag-modal-title"
          className={`absolute left-1/2 top-1/2 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-[24px] border border-white/10 bg-[#080808] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] transition duration-300 ${
            modalOpen ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <h2 id="tag-modal-title" className="text-[2rem] font-semibold text-white">
              {editingTag ? "Edit Tag" : "Create Tag"}
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

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <div className="mt-5">
              <label htmlFor="tag-name" className="mb-2 block text-sm font-medium text-white">
                Tag Name
              </label>
              <input
                id="tag-name"
                type="text"
                value={name}
                maxLength={TAG_NAME_MAX_LENGTH}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Billing"
                className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
              />
            </div>

            <fieldset className="mt-5">
              <legend className="mb-3 block text-sm font-medium text-white">
                Tag Color
              </legend>
              <div className="flex flex-wrap items-center gap-3">
                {colorOptions.map((option) => {
                  const isSelected = color.toLowerCase() === option;

                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setColor(option)}
                      aria-label={`Use color ${option}`}
                      aria-pressed={isSelected}
                      className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition ${
                        isSelected ? "border-white" : "border-transparent"
                      }`}
                      style={{ backgroundColor: option }}
                    >
                      <span
                        className={`h-2.5 w-2.5 rounded-full bg-white transition ${
                          isSelected ? "opacity-100" : "opacity-0"
                        }`}
                      />
                    </button>
                  );
                })}
                <label
                  htmlFor="tag-custom-color"
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-slate-300"
                >
                  Custom
                  <input
                    id="tag-custom-color"
                    type="color"
                    value={HEX_COLOR_PATTERN.test(color) && color.length === 7 ? color : "#f97316"}
                    onChange={(event) => setColor(event.target.value)}
                    className="h-6 w-8 cursor-pointer bg-transparent"
                  />
                </label>
              </div>
            </fieldset>

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
                type="submit"
                disabled={isSaving}
                className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
              >
                {isSaving ? "Saving..." : editingTag ? "Update Tag" : "Create Tag"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
