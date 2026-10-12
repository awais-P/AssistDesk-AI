"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  MAX_AGENT_MAX_TOKENS,
  MIN_AGENT_MAX_TOKENS,
  agentProviderOptions,
  agentResponseLengthOptions,
  agentToneOptions,
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
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  systemPrompt: string | null;
  inboxId: string | null;
  inboxName: string | null;
  temperature: number;
  confidenceThreshold: number;
  maxTokens: number;
  tone: string;
  responseLength: string;
  status: string;
};

type SavedAgentResponse = Omit<AgentItem, "inboxName"> & {
  inbox?: {
    name: string;
  } | null;
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
  maxTokens: 512,
  tone: "FRIENDLY",
  responseLength: "BALANCED",
  systemPrompt: defaultAgentSystemPrompt,
  status: "ACTIVE",
};

function formatDecimal(value: number) {
  return value.toFixed(1);
}

function formatAgentStatus(status: string) {
  if (status === "ACTIVE") return "Live";
  if (status === "ARCHIVED") return "Archived";
  return "Draft";
}

function agentStatusPillClass(status: string) {
  if (status === "ACTIVE") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }

  if (status === "ARCHIVED") {
    return "border-white/10 bg-white/5 text-slate-400";
  }

  return "border-amber-500/20 bg-amber-500/10 text-amber-200";
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
  const [cardError, setCardError] = useState<{
    agentId: string;
    message: string;
  } | null>(null);
  const availableModels = useMemo(
    () => getModelsForProvider(form.provider),
    [form.provider],
  );
  const selectedResponseLength =
    agentResponseLengthOptions.find(
      (option) => option.value === form.responseLength,
    ) ?? agentResponseLengthOptions[1];
  const selectedTone =
    agentToneOptions.find((option) => option.value === form.tone) ??
    agentToneOptions[0];

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
    if (isSaving) {
      return;
    }

    setError("");
    setSuccess("");

    if (!form.name.trim()) {
      setError("Give the agent a name before creating it.");
      return;
    }

    if (usesCustomApiKey(form.provider) && !form.apiKey.trim()) {
      setError(
        `Paste your ${form.provider} API key, or switch the provider to Default (Managed).`,
      );
      return;
    }

    if (
      !Number.isFinite(form.maxTokens) ||
      form.maxTokens < MIN_AGENT_MAX_TOKENS ||
      form.maxTokens > MAX_AGENT_MAX_TOKENS
    ) {
      setError(
        `Max reply tokens must be between ${MIN_AGENT_MAX_TOKENS} and ${MAX_AGENT_MAX_TOKENS}.`,
      );
      return;
    }

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
          apiKey: usesCustomApiKey(form.provider) ? form.apiKey.trim() : null,
          inboxId: form.inboxId || null,
          temperature: form.temperature,
          confidenceThreshold: form.confidenceThreshold,
          maxTokens: form.maxTokens,
          tone: form.tone,
          responseLength: form.responseLength,
          systemPrompt: form.systemPrompt,
          status: form.status,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        agent?: SavedAgentResponse;
      };

      if (!response.ok || !data.agent) {
        setError(
          data.error ??
            "Unable to create the AI agent right now. Check the fields and try again.",
        );
        return;
      }

      const nextAgent: AgentItem = {
        id: data.agent.id,
        name: data.agent.name,
        provider: data.agent.provider,
        model: data.agent.model,
        hasApiKey: data.agent.hasApiKey,
        apiKeyPreview: data.agent.apiKeyPreview,
        systemPrompt: data.agent.systemPrompt,
        inboxId: data.agent.inboxId,
        inboxName: data.agent.inbox?.name ?? null,
        temperature: data.agent.temperature,
        confidenceThreshold: data.agent.confidenceThreshold,
        maxTokens: data.agent.maxTokens,
        tone: data.agent.tone,
        responseLength: data.agent.responseLength,
        status: data.agent.status,
      };

      setAgents((current) => [nextAgent, ...current]);
      setSuccess("Agent created. Opening its configuration...");
      setDrawerOpen(false);
      router.push(`/dashboard/ai-agents/${nextAgent.id}`);
    } catch {
      setError(
        "Something went wrong while creating the AI agent. Check your connection and try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(agentId: string) {
    if (deletingId) {
      return;
    }

    const shouldDelete = window.confirm(
      "Delete this AI agent? This action cannot be undone.",
    );

    if (!shouldDelete) {
      return;
    }

    setDeletingId(agentId);
    setMenuOpenId("");
    setCardError(null);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/ai-agents/${agentId}`, {
        method: "DELETE",
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        // Shown on the agent's own card (e.g. 409 when chatbots still use it).
        setCardError({
          agentId,
          message: data.error ?? "Unable to delete the AI agent. Try again.",
        });
        return;
      }

      setAgents((current) => current.filter((agent) => agent.id !== agentId));
      setSuccess("Agent deleted.");
    } catch {
      setCardError({
        agentId,
        message:
          "Something went wrong while deleting the AI agent. Check your connection and try again.",
      });
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
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-white">
                          {agent.name}
                        </p>
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${agentStatusPillClass(agent.status)}`}
                        >
                          {formatAgentStatus(agent.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Model: {formatAgentRuntimeLabel(agent.model)} • ID:{" "}
                        {formatAgentShortId(agent.id)}
                      </p>
                    </div>
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      aria-label={`Actions for ${agent.name}`}
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
                    Tokens: {agent.maxTokens}
                  </span>
                  <span className="rounded-full bg-white/5 px-2.5 py-1">
                    {agentToneOptions.find((option) => option.value === agent.tone)
                      ?.label ?? agent.tone}
                  </span>
                </div>

                {agent.status !== "ACTIVE" ? (
                  <p className="mt-3 text-xs text-slate-500">
                    Not live yet: only the Playground can use this agent until
                    it is published.
                  </p>
                ) : null}

                {cardError?.agentId === agent.id ? (
                  <div
                    role="alert"
                    className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                  >
                    <p>{cardError.message}</p>
                    <button
                      type="button"
                      aria-label="Dismiss error"
                      onClick={() => setCardError(null)}
                      className="shrink-0 text-xs font-semibold text-red-100 transition hover:text-white"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}

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
                <label
                  htmlFor="create-agent-name"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Agent Name
                </label>
                <input
                  id="create-agent-name"
                  type="text"
                  value={form.name}
                  maxLength={80}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="create-agent-provider"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Provider
                  </label>
                  <select
                    id="create-agent-provider"
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
                  <label
                    htmlFor="create-agent-model"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Model
                  </label>
                  <select
                    id="create-agent-model"
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
                  <label
                    htmlFor="create-agent-api-key"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    API Key
                  </label>
                  <input
                    id="create-agent-api-key"
                    type="password"
                    autoComplete="off"
                    value={form.apiKey}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        apiKey: event.target.value,
                      }))
                    }
                    placeholder={`Paste your ${form.provider} API key`}
                    className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Required. The key is stored encrypted and only used for this
                    agent&apos;s selected provider. It is never shown again in full.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-[#101010] px-4 py-3 text-xs text-slate-400">
                  Managed default models use your server-side OpenRouter key and
                  automatically try the next available free model if one fails.
                </div>
              )}

              <div>
                <label
                  htmlFor="create-agent-inbox"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Inbox
                </label>
                <select
                  id="create-agent-inbox"
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

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="create-agent-tone"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Tone
                  </label>
                  <select
                    id="create-agent-tone"
                    value={form.tone}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        tone: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none"
                  >
                    {agentToneOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-slate-500">
                    {selectedTone.instruction}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="create-agent-response-length"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Response length
                  </label>
                  <select
                    id="create-agent-response-length"
                    value={form.responseLength}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        responseLength: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none"
                  >
                    {agentResponseLengthOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-slate-500">
                    {selectedResponseLength.instruction}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="create-agent-max-tokens"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Max reply tokens
                  </label>
                  <input
                    id="create-agent-max-tokens"
                    type="number"
                    min={MIN_AGENT_MAX_TOKENS}
                    max={MAX_AGENT_MAX_TOKENS}
                    step={1}
                    value={Number.isFinite(form.maxTokens) ? form.maxTokens : ""}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        maxTokens: event.target.valueAsNumber,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    {MIN_AGENT_MAX_TOKENS}–{MAX_AGENT_MAX_TOKENS}. Caps how long a
                    single reply can be.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="create-agent-status"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Status
                  </label>
                  <select
                    id="create-agent-status"
                    value={form.status}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-[#131313] px-4 py-3 text-sm text-white outline-none"
                  >
                    <option value="ACTIVE">Live (answers on all channels)</option>
                    <option value="DRAFT">Draft (Playground only)</option>
                  </select>
                  <p className="mt-2 text-xs text-slate-500">
                    Only live agents reply on the chat widget, Slack and
                    WhatsApp.
                  </p>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label
                    htmlFor="create-agent-confidence"
                    className="text-sm font-medium text-slate-300"
                  >
                    Confidence Threshold
                  </label>
                  <span className="text-sm text-slate-400">
                    {formatDecimal(form.confidenceThreshold)}
                  </span>
                </div>
                <input
                  id="create-agent-confidence"
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
                  <label
                    htmlFor="create-agent-temperature"
                    className="text-sm font-medium text-slate-300"
                  >
                    Temperature
                  </label>
                  <span className="text-sm text-slate-400">
                    {formatDecimal(form.temperature)}
                  </span>
                </div>
                <input
                  id="create-agent-temperature"
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
                <label
                  htmlFor="create-agent-system-prompt"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  System Prompt
                </label>
                <textarea
                  id="create-agent-system-prompt"
                  value={form.systemPrompt}
                  maxLength={8192}
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
