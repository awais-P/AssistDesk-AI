"use client";

import { useState } from "react";

type TagItem = {
  id: string;
  name: string;
  color: string;
};

type TagsWorkspaceProps = {
  initialTags: TagItem[];
};

const colorOptions = [
  "#f97316",
  "#facc15",
  "#22c55e",
  "#4f8cff",
  "#8b5cf6",
  "#ec4899",
];

export function TagsWorkspace({ initialTags }: TagsWorkspaceProps) {
  const [tags, setTags] = useState(initialTags);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagItem | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(colorOptions[0]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function openCreateModal() {
    setEditingTag(null);
    setName("");
    setColor(colorOptions[0]);
    setError("");
    setSuccess("");
    setModalOpen(true);
  }

  function openEditModal(tag: TagItem) {
    setEditingTag(tag);
    setName(tag.name);
    setColor(tag.color);
    setError("");
    setSuccess("");
    setModalOpen(true);
  }

  async function handleSave() {
    setError("");
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
          name,
          color,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        tag?: TagItem;
      };

      if (!response.ok || !data.tag) {
        setError(data.error ?? "Unable to save the tag.");
        setIsSaving(false);
        return;
      }

      setTags((current) => {
        const existingIndex = current.findIndex((item) => item.id === data.tag?.id);

        if (existingIndex === -1) {
          return [...current, data.tag as TagItem];
        }

        const next = [...current];
        next[existingIndex] = data.tag as TagItem;
        return next;
      });

      setSuccess(editingTag ? "Tag updated successfully." : "Tag created successfully.");
      setModalOpen(false);
    } catch {
      setError("Something went wrong while saving the tag.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(tagId: string) {
    const shouldDelete = window.confirm(
      "Delete this tag? This action cannot be undone.",
    );

    if (!shouldDelete) {
      return;
    }

    const response = await fetch(`/api/tags/${tagId}`, {
      method: "DELETE",
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to delete the tag.");
      return;
    }

    setTags((current) => current.filter((tag) => tag.id !== tagId));
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
        <div className="grid grid-cols-[1fr_220px] gap-4 border-b border-white/10 px-4 py-5 text-sm font-semibold text-white">
          <span>Tag</span>
          <span>Actions</span>
        </div>

        {tags.map((tag) => (
          <div
            key={tag.id}
            className="grid grid-cols-[1fr_220px] gap-4 border-b border-white/10 px-4 py-5 last:border-b-0"
          >
            <div className="flex items-center">
              <span
                className="rounded-lg border px-3 py-1 text-sm"
                style={{
                  borderColor: tag.color,
                  color: tag.color,
                }}
              >
                {tag.name}
              </span>
            </div>

            <div className="flex items-center gap-4 text-white">
              <button
                type="button"
                onClick={() => openEditModal(tag)}
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
                onClick={() => void handleDelete(tag.id)}
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
          aria-label="Close tag modal"
          onClick={() => setModalOpen(false)}
          className={`absolute inset-0 bg-black/60 transition duration-300 ${
            modalOpen ? "opacity-100" : "opacity-0"
          }`}
        />

        <div
          className={`absolute left-1/2 top-1/2 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-[24px] border border-white/10 bg-[#080808] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] transition duration-300 ${
            modalOpen ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-[2rem] font-semibold text-white">
              {editingTag ? "Edit Tag" : "Create Tag"}
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
              Tag Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
            />
          </div>

          <div className="mt-5">
            <label className="mb-3 block text-sm font-medium text-white">
              Tag Color
            </label>
            <div className="flex flex-wrap gap-3">
              {colorOptions.map((option) => {
                const isSelected = color === option;

                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setColor(option)}
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
              {isSaving ? "Saving..." : editingTag ? "Update Tag" : "Create Tag"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
