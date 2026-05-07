"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type InboxItem = {
  id: string;
  name: string;
  emailPrefix: string;
  senderEmail: string | null;
  autoReplyEnabled: boolean;
  ticketPrefix: string;
  assignedAgentName: string | null;
};

type InboxesWorkspaceProps = {
  initialInboxes: InboxItem[];
};

export function InboxesWorkspace({ initialInboxes }: InboxesWorkspaceProps) {
  const [inboxes, setInboxes] = useState(initialInboxes);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState("");

  const filteredInboxes = useMemo(() => {
    const searchValue = search.trim().toLowerCase();

    if (!searchValue) {
      return inboxes;
    }

    return inboxes.filter((inbox) => {
      return (
        inbox.name.toLowerCase().includes(searchValue) ||
        inbox.emailPrefix.toLowerCase().includes(searchValue) ||
        inbox.senderEmail?.toLowerCase().includes(searchValue) ||
        inbox.assignedAgentName?.toLowerCase().includes(searchValue)
      );
    });
  }, [inboxes, search]);

  async function handleDelete(id: string) {
    const shouldDelete = window.confirm(
      "Delete this inbox? This action cannot be undone.",
    );

    if (!shouldDelete) {
      return;
    }

    setDeletingId(id);
    setError("");

    try {
      const response = await fetch(`/api/inboxes/${id}`, {
        method: "DELETE",
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to delete this inbox.");
        setDeletingId("");
        return;
      }

      setInboxes((current) => current.filter((inbox) => inbox.id !== id));
    } catch {
      setError("Something went wrong while deleting the inbox.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
            Inboxes
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-400">
            Create separate inboxes for support, sales, and business teams with
            clean dedicated configuration pages and compact workspace controls.
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <div className="inline-flex h-10 items-center rounded-lg border border-white/10 bg-[#111111] px-3">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search..."
              className="w-[170px] bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            />
          </div>
          <Link
            href="/dashboard/inboxes/new"
            className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
          >
            + Create Inbox
          </Link>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-[#0a0a0a]">
        <div className="grid min-w-[760px] grid-cols-[1.1fr_1.2fr_0.55fr_1fr_110px] border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          <span>Name</span>
          <span>Email</span>
          <span>Prefix</span>
          <span>AI Agent</span>
          <span className="text-right">Actions</span>
        </div>

        <div>
          {filteredInboxes.length === 0 ? (
            <div className="px-4 py-8 text-sm text-slate-400">
              No inboxes match the current search.
            </div>
          ) : (
            filteredInboxes.map((inbox) => (
              <div
                key={inbox.id}
                className="grid min-w-[760px] grid-cols-[1.1fr_1.2fr_0.55fr_1fr_110px] items-center border-b border-white/10 px-4 py-4 text-sm last:border-b-0"
              >
                <span className="font-semibold text-white">{inbox.name}</span>
                <span className="truncate text-slate-300">
                  {inbox.emailPrefix}@assistdesk.ai
                </span>
                <span className="text-slate-400">{inbox.ticketPrefix}</span>
                <span className="truncate text-slate-400">
                  {inbox.assignedAgentName || "Unassigned"}
                </span>
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/dashboard/inboxes/${inbox.id}`}
                    className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#1a1a1a]"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    disabled={deletingId === inbox.id}
                    onClick={() => handleDelete(inbox.id)}
                    className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-60"
                  >
                    {deletingId === inbox.id ? "..." : "Delete"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
