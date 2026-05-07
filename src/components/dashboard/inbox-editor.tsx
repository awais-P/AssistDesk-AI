"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type AgentOption = {
  id: string;
  name: string;
};

type InboxEditorProps = {
  mode: "create" | "edit";
  inbox?: {
    id: string;
    name: string;
    emailPrefix: string;
    senderEmail: string | null;
    autoReplyEnabled: boolean;
    ticketPrefix: string;
    assignedAgentId: string | null;
  };
  agentOptions: AgentOption[];
  currentUserEmail: string;
};

function derivePrefix(name: string) {
  return (name.trim().slice(0, 2).toUpperCase() || "AD").replace(/[^A-Z]/g, "");
}

export function InboxEditor({
  mode,
  inbox,
  agentOptions,
  currentUserEmail,
}: InboxEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(inbox?.name ?? "");
  const [emailPrefix, setEmailPrefix] = useState(inbox?.emailPrefix ?? "");
  const [ticketPrefix, setTicketPrefix] = useState(
    inbox?.ticketPrefix ?? derivePrefix(inbox?.name ?? ""),
  );
  const [senderEmail, setSenderEmail] = useState(
    inbox?.senderEmail ?? currentUserEmail,
  );
  const [assignedAgentId, setAssignedAgentId] = useState(
    inbox?.assignedAgentId ?? "",
  );
  const [checkMessage, setCheckMessage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function checkAvailability() {
    setError("");
    setCheckMessage("");

    const response = await fetch(
      `/api/inboxes?emailPrefix=${encodeURIComponent(emailPrefix)}`,
    );
    const data = (await response.json()) as { message?: string };
    setCheckMessage(data.message ?? "Unable to check right now.");
  }

  async function handleSave() {
    setError("");
    setSuccess("");
    setIsSaving(true);

    try {
      const response = await fetch("/api/inboxes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: inbox?.id,
          name,
          emailPrefix,
          senderEmail,
          autoReplyEnabled: true,
          ticketPrefix: ticketPrefix || derivePrefix(name),
          assignedAgentId: assignedAgentId || null,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        inbox?: {
          id: string;
        };
      };

      if (!response.ok || !data.inbox) {
        setError(data.error ?? "Unable to save the inbox right now.");
        setIsSaving(false);
        return;
      }

      setSuccess(mode === "edit" ? "Inbox updated successfully." : "Inbox created successfully.");

      if (mode === "create") {
        router.push(`/dashboard/inboxes/${data.inbox.id}`);
      } else {
        router.refresh();
      }
    } catch {
      setError("Something went wrong while saving the inbox.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!inbox?.id) {
      router.push("/dashboard/inboxes");
      return;
    }

    const shouldDelete = window.confirm(
      "Delete this inbox? This action cannot be undone.",
    );

    if (!shouldDelete) {
      return;
    }

    setError("");
    setSuccess("");
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/inboxes/${inbox.id}`, {
        method: "DELETE",
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to delete the inbox.");
        setIsDeleting(false);
        return;
      }

      router.push("/dashboard/inboxes");
    } catch {
      setError("Something went wrong while deleting the inbox.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="mx-auto max-w-[760px]">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard/inboxes"
                className="pressable inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-sm text-white transition hover:bg-[#1a1a1a]"
              >
                ←
              </Link>
              <div>
                <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
                  Inbox Configuration
                </h1>
                <p className="mt-2 text-sm text-slate-400">
                  Configure your helpdesk inbox settings with a dedicated compact
                  editor page.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Inbox Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => {
                    const nextName = event.target.value;
                    setName(nextName);
                    if (!ticketPrefix) {
                      setTicketPrefix(derivePrefix(nextName));
                    }
                  }}
                  className="w-full rounded-xl border border-white/10 bg-[#151515] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Email Address
                </label>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <input
                    type="text"
                    value={emailPrefix}
                    onChange={(event) => setEmailPrefix(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#151515] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                  />
                  <div className="inline-flex items-center rounded-xl border border-white/10 bg-[#151515] px-4 text-sm text-slate-400">
                    @assistdesk.ai
                  </div>
                  <button
                    type="button"
                    onClick={checkAvailability}
                    className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#151515] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1c1c1c]"
                  >
                    Check
                  </button>
                </div>
                {checkMessage ? (
                  <p className="mt-2 text-xs text-slate-400">{checkMessage}</p>
                ) : null}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Ticket Prefix
                </label>
                <input
                  type="text"
                  value={ticketPrefix}
                  onChange={(event) => setTicketPrefix(event.target.value.toUpperCase())}
                  className="w-full rounded-xl border border-white/10 bg-[#151515] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-white">
                  Sender Configuration
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  Choose the sender email used for inbox replies and ticket
                  notifications.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSenderEmail(currentUserEmail)}
                  className="rounded-lg border border-white/10 bg-[#151515] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#1c1c1c]"
                >
                  Use Workspace Email
                </button>
                <button
                  type="button"
                  onClick={() => setSenderEmail("")}
                  className="rounded-lg border border-white/10 bg-[#151515] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#1c1c1c]"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-[#151515] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Sender Email
              </p>
              <input
                type="email"
                value={senderEmail}
                onChange={(event) => setSenderEmail(event.target.value)}
                placeholder="support@yourcompany.com"
                className="mt-3 w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
              />
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
            <p className="text-base font-semibold text-white">AI Agent</p>
            <p className="mt-1 text-sm text-slate-400">
              Assign an AI agent to automatically handle tickets in this inbox.
            </p>

            <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-[#111111] p-4">
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Select an AI Agent
              </label>
              <select
                value={assignedAgentId}
                onChange={(event) => setAssignedAgentId(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#151515] px-4 py-3 text-sm text-white outline-none"
              >
                <option value="">No Agent Assigned</option>
                {agentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          ) : null}

          {success ? (
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {success}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={isDeleting}
              onClick={handleDelete}
              className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-60"
            >
              {mode === "edit"
                ? isDeleting
                  ? "Deleting..."
                  : "Delete Inbox"
                : "Cancel"}
            </button>

            <div className="flex gap-3">
              <Link
                href="/dashboard/inboxes"
                className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
              >
                Back to Inboxes
              </Link>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSave}
                className="inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
