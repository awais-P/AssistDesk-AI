"use client";

import { useMemo, useState } from "react";
import { DashboardPageHeader } from "./dashboard-page-header";

type IntegrationItem = {
  id: string;
  type: "EMAIL" | "WHATSAPP" | "SLACK" | "VOICE";
  name: string;
  provider: string;
  status: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
  supportAddress: string | null;
  forwardingAddress: string | null;
  webhookSecret: string | null;
  isActive: boolean;
  inboxId: string | null;
  inboxName: string | null;
  agentId: string | null;
  agentName: string | null;
  config: Record<string, unknown>;
};

type InboxesOption = {
  id: string;
  name: string;
  emailPrefix: string;
};

type AgentOption = {
  id: string;
  name: string;
  status: string;
};

type IntegrationsWorkspaceProps = {
  initialIntegrations: IntegrationItem[];
  inboxes: InboxesOption[];
  agents: AgentOption[];
};

const channelCards = [
  {
    type: "EMAIL" as const,
    title: "Email Integration",
    description:
      "Connect a support email so incoming emails automatically become tickets in the dashboard.",
    enabled: true,
  },
  {
    type: "WHATSAPP" as const,
    title: "WhatsApp",
    description:
      "Prepare future WhatsApp Business support intake and AI-driven conversation routing.",
    enabled: false,
  },
  {
    type: "SLACK" as const,
    title: "Slack",
    description:
      "Prepare Slack-based ticket intake and conversational support inside connected workspaces.",
    enabled: false,
  },
  {
    type: "VOICE" as const,
    title: "Voice Calls",
    description:
      "Prepare real-time voice intake, transcription, and AI-assisted support escalation.",
    enabled: false,
  },
] as const;

const emptyEmailForm = {
  id: "",
  name: "Primary Email Integration",
  provider: "Forwarded Inbox",
  supportAddress: "",
  forwardingAddress: "",
  inboxId: "",
  agentId: "",
  autoCreateTickets: true,
  syncReplies: true,
};

function statusBadge(status: IntegrationItem["status"]) {
  if (status === "CONNECTED") {
    return "rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-200";
  }

  if (status === "CONNECTING") {
    return "rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-200";
  }

  if (status === "ERROR") {
    return "rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-200";
  }

  return "rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-300";
}

export function IntegrationsWorkspace({
  initialIntegrations,
  inboxes,
  agents,
}: IntegrationsWorkspaceProps) {
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(emptyEmailForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");

  const emailIntegrations = useMemo(
    () => integrations.filter((item) => item.type === "EMAIL"),
    [integrations],
  );

  const activeEmailIntegration = emailIntegrations[0] || null;

  function openEmailDrawer(integration?: IntegrationItem) {
    if (integration) {
      setForm({
        id: integration.id,
        name: integration.name,
        provider: integration.provider,
        supportAddress: integration.supportAddress || "",
        forwardingAddress: integration.forwardingAddress || "",
        inboxId: integration.inboxId || "",
        agentId: integration.agentId || "",
        autoCreateTickets: integration.config.autoCreateTickets !== false,
        syncReplies: integration.config.syncReplies !== false,
      });
    } else {
      setForm({
        ...emptyEmailForm,
        inboxId: inboxes[0]?.id || "",
        agentId: agents[0]?.id || "",
      });
    }

    setError("");
    setSuccess("");
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setError("");
  }

  async function handleSaveEmailIntegration() {
    setError("");
    setSuccess("");

    if (!form.name.trim()) {
      setError("Integration name is required.");
      return;
    }

    if (!form.supportAddress.trim()) {
      setError("Support address is required.");
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: form.id || undefined,
          type: "EMAIL",
          name: form.name,
          provider: form.provider,
          status: "CONNECTED",
          supportAddress: form.supportAddress,
          forwardingAddress: form.forwardingAddress || null,
          inboxId: form.inboxId || null,
          agentId: form.agentId || null,
          isActive: true,
          config: {
            autoCreateTickets: form.autoCreateTickets,
            syncReplies: form.syncReplies,
          },
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        integration?: {
          id: string;
          type: "EMAIL" | "WHATSAPP" | "SLACK" | "VOICE";
          name: string;
          provider: string;
          status: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
          supportAddress: string | null;
          forwardingAddress: string | null;
          webhookSecret: string | null;
          isActive: boolean;
          inboxId: string | null;
          agentId: string | null;
          config: Record<string, unknown>;
          inbox?: { name: string | null } | null;
          agent?: { name: string | null } | null;
        };
      };

      if (!response.ok || !data.integration) {
        setError(data.error ?? "Unable to save the email integration.");
        setIsSaving(false);
        return;
      }

      const nextIntegration: IntegrationItem = {
        id: data.integration.id,
        type: data.integration.type,
        name: data.integration.name,
        provider: data.integration.provider,
        status: data.integration.status,
        supportAddress: data.integration.supportAddress,
        forwardingAddress: data.integration.forwardingAddress,
        webhookSecret: data.integration.webhookSecret,
        isActive: data.integration.isActive,
        inboxId: data.integration.inboxId,
        inboxName: data.integration.inbox?.name ?? null,
        agentId: data.integration.agentId,
        agentName: data.integration.agent?.name ?? null,
        config: data.integration.config ?? {},
      };

      setIntegrations((current) => {
        const existingIndex = current.findIndex(
          (item) => item.id === nextIntegration.id,
        );

        if (existingIndex >= 0) {
          const next = [...current];
          next[existingIndex] = nextIntegration;
          return next;
        }

        return [nextIntegration, ...current];
      });

      setSuccess("Email integration saved successfully.");
      setDrawerOpen(false);
    } catch {
      setError("Something went wrong while saving the email integration.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteIntegration(id: string) {
    const shouldDelete = window.confirm(
      "Delete this integration? This action cannot be undone.",
    );

    if (!shouldDelete) {
      return;
    }

    setDeletingId(id);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/integrations/${id}`, {
        method: "DELETE",
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to delete this integration.");
        setDeletingId("");
        return;
      }

      setIntegrations((current) => current.filter((item) => item.id !== id));
      setSuccess("Integration deleted successfully.");
    } catch {
      setError("Something went wrong while deleting the integration.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <DashboardPageHeader
        title="Integrations"
        actionLabel="Connect Email"
        actionStyle="light"
        onActionClick={() => openEmailDrawer(activeEmailIntegration || undefined)}
      />

      <p className="mt-3 max-w-3xl text-sm text-slate-400">
        Connect support channels so requests can enter AssistDesk automatically.
        Email is the first operational integration and converts incoming messages
        into tickets that follow your inbox and AI agent workflow.
      </p>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {channelCards.map((card) => {
          const emailConnected =
            card.type === "EMAIL" && emailIntegrations.length > 0;

          return (
            <article
              key={card.type}
              className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[1.35rem] font-semibold text-white">
                    {card.title}
                  </p>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
                    {card.description}
                  </p>
                </div>
                {card.type === "EMAIL" && emailConnected ? (
                  <span className={statusBadge("CONNECTED")}>connected</span>
                ) : (
                  <span className={statusBadge("DISCONNECTED")}>
                    {card.enabled ? "not connected" : "coming soon"}
                  </span>
                )}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                {card.enabled ? (
                  <button
                    type="button"
                    onClick={() =>
                      card.type === "EMAIL"
                        ? openEmailDrawer(activeEmailIntegration || undefined)
                        : undefined
                    }
                    className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
                  >
                    {emailConnected ? "Manage Connection" : "Connect"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-semibold text-slate-500"
                  >
                    Coming Soon
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-8 space-y-4">
        {emailIntegrations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-[#0a0a0a] px-5 py-8 text-sm text-slate-400">
            No email integrations are connected yet. Connect one to start
            converting incoming emails into tickets automatically.
          </div>
        ) : (
          emailIntegrations.map((integration) => (
            <section
              key={integration.id}
              className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5"
            >
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-[1.3rem] font-semibold text-white">
                      {integration.name}
                    </p>
                    <span className={statusBadge(integration.status)}>
                      {integration.status.toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">
                    Provider: {integration.provider}
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openEmailDrawer(integration)}
                    className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a1a1a]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === integration.id}
                    onClick={() => void handleDeleteIntegration(integration.id)}
                    className="pressable inline-flex items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/15 disabled:opacity-60"
                  >
                    {deletingId === integration.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-[#111111] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Support Address
                  </p>
                  <p className="mt-3 text-base font-medium text-white">
                    {integration.supportAddress || "Not configured"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#111111] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Forwarding Address
                  </p>
                  <p className="mt-3 text-base font-medium text-white">
                    {integration.forwardingAddress || "Not configured"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#111111] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Inbox
                  </p>
                  <p className="mt-3 text-base font-medium text-white">
                    {integration.inboxName || "No inbox linked"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#111111] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    AI Agent
                  </p>
                  <p className="mt-3 text-base font-medium text-white">
                    {integration.agentName || "No agent linked"}
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-white/10 bg-[#111111] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Inbound Endpoint
                </p>
                <p className="mt-3 break-all text-sm text-white">
                  /api/integrations/email/inbound
                </p>
                <p className="mt-3 text-xs text-slate-400">
                  Use this endpoint for provider forwarding or webhook-based
                  ingestion. Match the connected email using the webhook secret,
                  support address, or forwarding address.
                </p>
                {integration.webhookSecret ? (
                  <p className="mt-4 break-all text-xs text-slate-500">
                    Secret: {integration.webhookSecret}
                  </p>
                ) : null}
              </div>
            </section>
          ))
        )}
      </div>

      <div
        className={`fixed inset-0 z-50 transition ${
          drawerOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <button
          type="button"
          aria-label="Close drawer"
          onClick={closeDrawer}
          className={`absolute inset-0 bg-black/60 transition duration-300 ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
        />

        <aside
          className={`absolute right-0 top-0 h-full w-full max-w-[470px] border-l border-white/10 bg-[#090909] shadow-[-16px_0_40px_rgba(0,0,0,0.45)] transition duration-300 ${
            drawerOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-xl font-semibold text-white">
                {form.id ? "Edit Email Integration" : "Connect Email Integration"}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                Link a support email so incoming emails create tickets in your
                dashboard automatically.
              </p>
            </div>
            <button
              type="button"
              onClick={closeDrawer}
              className="pressable rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-[#1a1a1a]"
            >
              Close
            </button>
          </div>

          <div className="h-[calc(100%-90px)] overflow-y-auto px-5 py-4">
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Connection Name
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Provider
                </label>
                <select
                  value={form.provider}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      provider: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none"
                >
                  {["Forwarded Inbox", "Gmail", "Outlook", "Custom SMTP"].map(
                    (provider) => (
                      <option key={provider} value={provider}>
                        {provider}
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Support Address
                </label>
                <input
                  type="email"
                  value={form.supportAddress}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      supportAddress: event.target.value,
                    }))
                  }
                  placeholder="support@yourcompany.com"
                  className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Forwarding Address
                </label>
                <input
                  type="email"
                  value={form.forwardingAddress}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      forwardingAddress: event.target.value,
                    }))
                  }
                  placeholder="forward-to@assistdesk.local"
                  className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                />
                <p className="mt-2 text-xs text-slate-500">
                  This can be the address you forward provider emails into for
                  ticket creation.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Inbox
                  </label>
                  <select
                    value={form.inboxId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        inboxId: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none"
                  >
                    <option value="">No Inbox</option>
                    {inboxes.map((inbox) => (
                      <option key={inbox.id} value={inbox.id}>
                        {inbox.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    AI Agent
                  </label>
                  <select
                    value={form.agentId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        agentId: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none"
                  >
                    <option value="">No Agent</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-white/10 bg-[#101010] px-4 py-4">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">
                    Auto-create tickets from emails
                  </span>
                  <input
                    type="checkbox"
                    checked={form.autoCreateTickets}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        autoCreateTickets: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-white"
                  />
                </label>

                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">
                    Sync outgoing replies later
                  </span>
                  <input
                    type="checkbox"
                    checked={form.syncReplies}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        syncReplies: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-white"
                  />
                </label>
              </div>

              {error ? (
                <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </p>
              ) : null}

              <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleSaveEmailIntegration()}
                  className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
                >
                  {isSaving ? "Saving..." : form.id ? "Save Changes" : "Connect Email"}
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
