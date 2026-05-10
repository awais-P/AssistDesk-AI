"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  agentProviderOptions,
  defaultAgentSystemPrompt,
  formatAgentRuntimeLabel,
  formatAgentShortId,
  getDefaultModelForProvider,
  getModelsForProvider,
  usesCustomApiKey,
} from "@/src/lib/agent-config";

type AgentItem = {
  id: string;
  name: string;
  provider: string;
  model: string;
  apiKey: string | null;
  systemPrompt: string | null;
  inboxId: string | null;
  inboxName: string | null;
  temperature: number;
  confidenceThreshold: number;
  status: string;
};

type InboxOption = {
  id: string;
  name: string;
  emailPrefix: string;
};

type AgentsWorkspaceProps = {
  initialAgents: AgentItem[];
  inboxOptions: InboxOption[];
};

const emptyAgentForm = {
  name: "",
  provider: "Default",
  model: getDefaultModelForProvider("Default"),
  apiKey: "",
  inboxId: "",
  temperature: 0.7,
  confidenceThreshold: 0.5,
  systemPrompt: defaultAgentSystemPrompt,
  status: "ACTIVE",
};

function formatDecimal(value: number) {
  return value.toFixed(1);
}

export function AgentsWorkspace({
  initialAgents,
  inboxOptions,
}: AgentsWorkspaceProps) {
  const router = useRouter();
  const [agents, setAgents] = useState(initialAgents);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [menuOpenId, setMenuOpenId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(emptyAgentForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const availableModels = useMemo(
    () => getModelsForProvider(form.provider),
    [form.provider],
  );

  useEffect(() => {
    function handleWindowClick() {
      setMenuOpenId("");
    }

    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  const filteredAgents = useMemo(() => {
    const searchValue = search.trim().toLowerCase();

    if (!searchValue) {
      return agents;
    }

    return agents.filter((agent) => {
      return (
        agent.name.toLowerCase().includes(searchValue) ||
        agent.model.toLowerCase().includes(searchValue) ||
        agent.provider.toLowerCase().includes(searchValue) ||
        agent.systemPrompt?.toLowerCase().includes(searchValue)
      );
    });
  }, [agents, search]);

  function openCreateDrawer() {
    setForm(emptyAgentForm);
    setError("");
    setSuccess("");
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setError("");
    setSuccess("");
  }

  async function handleSave() {
    setError("");
    setSuccess("");
    setIsSaving(true);

    try {
      const response = await fetch("/api/ai-agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name,
          provider: form.provider,
          model: form.model,
          apiKey: usesCustomApiKey(form.provider) ? form.apiKey : null,
          inboxId: form.inboxId || null,
          temperature: form.temperature,
          confidenceThreshold: form.confidenceThreshold,
          systemPrompt: form.systemPrompt,
          status: form.status,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        agent?: {
          id: string;
          name: string;
          provider: string;
          model: string;
          apiKey: string | null;
          systemPrompt: string | null;
          inboxId: string | null;
          temperature: number;
          confidenceThreshold: number;
          status: string;
          inbox?: {
            name: string;
          } | null;
        };
      };

      if (!response.ok || !data.agent) {
        setError(data.error ?? "Unable to create the AI agent right now.");
        setIsSaving(false);
        return;
      }

      const nextAgent: AgentItem = {
        id: data.agent.id,
        name: data.agent.name,
        provider: data.agent.provider,
        model: data.agent.model,
        apiKey: data.agent.apiKey,
        systemPrompt: data.agent.systemPrompt,
        inboxId: data.agent.inboxId,
        inboxName: data.agent.inbox?.name ?? null,
        temperature: data.agent.temperature,
        confidenceThreshold: data.agent.confidenceThreshold,
        status: data.agent.status,
      };

      setAgents((current) => [nextAgent, ...current]);
      setSuccess("Agent created successfully.");
      setDrawerOpen(false);
      router.push(`/dashboard/ai-agents/${nextAgent.id}`);
    } catch {
      setError("Something went wrong while creating the AI agent.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(agentId: string) {
    const shouldDelete = window.confirm(
      "Delete this AI agent? This action cannot be undone.",
    );

    if (!shouldDelete) {
      return;
    }

    setDeletingId(agentId);
    setMenuOpenId("");

    try {
      const response = await fetch(`/api/ai-agents/${agentId}`, {
        method: "DELETE",
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to delete the AI agent.");
        setDeletingId("");
        return;
      }

      setAgents((current) => current.filter((agent) => agent.id !== agentId));
    } catch {
      setError("Something went wrong while deleting the AI agent.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
            Agents
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Manage your AI agents and open a dedicated configuration flow for
            sources, automations, playground testing, and settings.
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <div className="inline-flex h-10 items-center rounded-lg border border-white/10 bg-[#111111] px-3">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search..."
              className="w-[190px] bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            />
          </div>
          <div className="inline-flex rounded-lg border border-white/10 bg-[#111111] p-1">
            {(["grid", "list"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  view === item
                    ? "bg-white text-[#050505]"
                    : "text-slate-300 hover:bg-white/5"
                }`}
              >
                {item === "grid" ? "Grid" : "List"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={openCreateDrawer}
            className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
          >
            + Create Agent
          </button>
        </div>
      </div>

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

      <div className="mt-6">
        <div
          className={`grid gap-4 ${
            view === "grid" ? "lg:grid-cols-2" : "grid-cols-1"
          }`}
        >
          {filteredAgents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-[#0a0a0a] px-5 py-8 text-sm text-slate-400">
              No agents match the current search. Create a new one to get
              started.
            </div>
          ) : (
            filteredAgents.map((agent) => (
              <article
                key={agent.id}
                className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-4 transition hover:border-white/20 hover:bg-[#111111]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-sm font-semibold text-white">
                      <svg
                        viewBox="0 0 24 24"
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <rect x="5" y="7" width="14" height="10" rx="2" />
                        <path d="M9 7V5h6v2" />
                        <path d="M8 12h.01M16 12h.01" />
                        <path d="M10 14h4" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-base font-semibold text-white">
                        {agent.name}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Model: {formatAgentRuntimeLabel(agent.model)} • ID:{" "}
                        {formatAgentShortId(agent.id)}
                      </p>
                    </div>
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpenId((current) =>
                          current === agent.id ? "" : agent.id,
                        );
                      }}
                      className="pressable inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#1a1a1a]"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="currentColor"
                      >
                        <circle cx="12" cy="5" r="1.8" />
                        <circle cx="12" cy="12" r="1.8" />
                        <circle cx="12" cy="19" r="1.8" />
                      </svg>
                    </button>

                    {menuOpenId === agent.id ? (
                      <div
                        className="absolute right-0 top-11 z-20 min-w-[150px] rounded-xl border border-white/10 bg-[#0f0f0f] p-1.5 shadow-[0_14px_32px_rgba(0,0,0,0.45)]"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Link
                          href={`/dashboard/ai-agents/${agent.id}`}
                          className="block rounded-lg px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          disabled={deletingId === agent.id}
                          onClick={() => handleDelete(agent.id)}
                          className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-200 transition hover:bg-red-500/10 disabled:opacity-60"
                        >
                          {deletingId === agent.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-400">
                  {agent.systemPrompt || "No system prompt configured."}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="rounded-full bg-white/5 px-2.5 py-1">
                    Temp: {formatDecimal(agent.temperature)}
                  </span>
                  <span className="rounded-full bg-white/5 px-2.5 py-1">
                    Tokens: 512
                  </span>
                  <span className="rounded-full bg-white/5 px-2.5 py-1">
                    {agent.status}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    Inbox: {agent.inboxName || "Unassigned"}
                  </p>
                  <Link
                    href={`/dashboard/ai-agents/${agent.id}`}
                    className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#1a1a1a]"
                  >
                    Open Agent
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
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
          className={`absolute right-0 top-0 h-full w-full max-w-[460px] border-l border-white/10 bg-[#090909] shadow-[-16px_0_40px_rgba(0,0,0,0.45)] transition duration-300 ${
            drawerOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-xl font-semibold text-white">Create AI Agent</p>
              <p className="mt-1 text-sm text-slate-400">
                Start with the essentials, then continue into the full
                configuration flow.
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
                  Agent Name
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

              <div className="grid gap-3 sm:grid-cols-2">
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
                      model: getDefaultModelForProvider(event.target.value),
                      apiKey: "",
                    }))
                  }
                    className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none"
                  >
                    {agentProviderOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Model
                  </label>
                  <select
                    value={form.model}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none"
                  >
                    {availableModels.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {usesCustomApiKey(form.provider) ? (
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        apiKey: event.target.value,
                      }))
                    }
                    placeholder="Paste your provider API key"
                    className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    This key will be used only for this agent&apos;s selected provider.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-[#101010] px-4 py-3 text-xs text-slate-400">
                  Managed default models use your server-side OpenRouter key and
                  automatically try the next available free model if one fails.
                </div>
              )}

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
                  {inboxOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} ({option.emailPrefix}@assistdesk.ai)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-300">
                    Confidence Threshold
                  </label>
                  <span className="text-sm text-slate-400">
                    {formatDecimal(form.confidenceThreshold)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.1"
                  value={form.confidenceThreshold}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      confidenceThreshold: Number(event.target.value),
                    }))
                  }
                  className="w-full accent-white"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-300">
                    Temperature
                  </label>
                  <span className="text-sm text-slate-400">
                    {formatDecimal(form.temperature)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={form.temperature}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      temperature: Number(event.target.value),
                    }))
                  }
                  className="w-full accent-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  System Prompt
                </label>
                <textarea
                  value={form.systemPrompt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      systemPrompt: event.target.value,
                    }))
                  }
                  className="min-h-[220px] w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white"
                />
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
                  onClick={handleSave}
                  className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
                >
                  {isSaving ? "Creating..." : "Create Agent"}
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
