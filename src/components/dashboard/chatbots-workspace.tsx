"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  allowedDomainsHelpText,
  buildEmbedSnippet,
  chatbotColorOptions,
  defaultChatbotSettings,
  defaultChatbotWelcomeMessage,
  defaultFallbackDelaySeconds,
  formatReplyModeLabel,
  formatWidgetPositionLabel,
  getChatbotInitial,
  normalizeChatbotDomain,
  parseChatbotDomainInput,
} from "@/src/lib/chatbot-config";

type ChatbotItem = {
  id: string;
  name: string;
  widgetId: string;
  agentId: string;
  agentName: string;
  agentStatus: string;
  allowedDomains: string[];
  primaryColor: string;
  welcomeMessage: string | null;
  isActive: boolean;
  maxAiMessages: number;
  aiRepliesEnabled: boolean;
  replyMode: string;
  fallbackDelaySeconds: number;
  additionalPrompt: string | null;
  avatarUrl: string | null;
  conversationStarters: string[];
  widgetPosition: string;
  requireName: boolean;
  requireEmail: boolean;
  requirePhone: boolean;
  emailNotifications: boolean;
};

type AgentOption = {
  id: string;
  name: string;
  status: string;
};

type ChatbotResponse = Omit<ChatbotItem, "agentName" | "agentStatus"> & {
  agent: { id: string; name: string; status: string };
};

type ChatbotsWorkspaceProps = {
  initialChatbots: ChatbotItem[];
  agentOptions: AgentOption[];
};

const emptyChatbotForm = {
  name: "",
  agentId: "",
  domainInput: "",
  allowedDomains: ["localhost"],
  welcomeMessage: defaultChatbotWelcomeMessage,
  primaryColor: "#3b82f6",
};

function SectionLabel({
  icon,
  title,
}: {
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
      <span className="text-slate-400">{icon}</span>
      <span>{title}</span>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  label,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#171717] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function ChatbotsWorkspace({
  initialChatbots,
  agentOptions,
}: ChatbotsWorkspaceProps) {
  const router = useRouter();
  const [chatbots, setChatbots] = useState(initialChatbots);
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(emptyChatbotForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [drawerError, setDrawerError] = useState("");
  const [domainError, setDomainError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:3000");

  useEffect(() => {
    setBaseUrl(window.location.origin);
  }, []);

  const selectedAgent = agentOptions.find((agent) => agent.id === form.agentId);

  const filteredChatbots = useMemo(() => {
    const value = search.trim().toLowerCase();

    if (!value) {
      return chatbots;
    }

    return chatbots.filter((chatbot) => {
      return (
        chatbot.name.toLowerCase().includes(value) ||
        chatbot.agentName.toLowerCase().includes(value) ||
        chatbot.allowedDomains.some((domain) =>
          domain.toLowerCase().includes(value),
        )
      );
    });
  }, [chatbots, search]);

  function openDrawer() {
    setDrawerOpen(true);
    setError("");
    setSuccess("");
    setDrawerError("");
    setDomainError("");
  }

  function closeDrawer() {
    if (isSaving) {
      return;
    }

    setDrawerOpen(false);
  }

  function addDomain() {
    const result = parseChatbotDomainInput(form.domainInput, form.allowedDomains);

    if (result.error !== undefined) {
      setDomainError(result.error);
      return;
    }

    setForm((current) => ({
      ...current,
      allowedDomains: [...current.allowedDomains, result.domain],
      domainInput: "",
    }));
    setDomainError("");
  }

  function removeDomain(domain: string) {
    setForm((current) => ({
      ...current,
      allowedDomains: current.allowedDomains.filter((item) => item !== domain),
    }));
  }

  async function handleCreateChatbot() {
    setError("");
    setSuccess("");
    setDrawerError("");

    if (!form.name.trim()) {
      setDrawerError("Give the chatbot a name, for example Website Chat.");
      return;
    }

    if (!form.agentId) {
      setDrawerError(
        agentOptions.length === 0
          ? "Create an AI agent first under AI Agents, then come back to link it."
          : "Select the AI agent that should answer visitors on this widget.",
      );
      return;
    }

    let allowedDomains = form.allowedDomains;

    // Include a domain that was typed but not added yet, so it is not silently lost.
    const pendingDomain = normalizeChatbotDomain(form.domainInput);

    if (pendingDomain && !form.allowedDomains.includes(pendingDomain)) {
      const result = parseChatbotDomainInput(form.domainInput, form.allowedDomains);

      if (result.error !== undefined) {
        setDomainError(result.error);
        setDrawerError("Fix the domain under Allowed Domains, or clear the field, then try again.");
        return;
      }

      allowedDomains = [...form.allowedDomains, result.domain];
      setForm((current) => ({ ...current, allowedDomains, domainInput: "" }));
    }

    if (allowedDomains.length === 0) {
      setDrawerError("Add at least one allowed domain, for example example.com.");
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/chatbots", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name,
          agentId: form.agentId,
          allowedDomains,
          primaryColor: form.primaryColor,
          welcomeMessage: form.welcomeMessage,
          maxAiMessages: 20,
          isActive: true,
          aiRepliesEnabled: defaultChatbotSettings.aiRepliesEnabled,
          replyMode: defaultChatbotSettings.replyMode,
          widgetPosition: defaultChatbotSettings.widgetPosition,
          requireName: defaultChatbotSettings.requireName,
          requireEmail: defaultChatbotSettings.requireEmail,
          requirePhone: defaultChatbotSettings.requirePhone,
          emailNotifications: defaultChatbotSettings.emailNotifications,
          fallbackDelaySeconds: defaultFallbackDelaySeconds,
          conversationStarters: [],
          avatarUrl: null,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        chatbot?: ChatbotResponse;
      };

      if (!response.ok || !data.chatbot) {
        setDrawerError(
          data.error ?? "Unable to create the chatbot right now. Please try again.",
        );
        return;
      }

      const nextChatbot: ChatbotItem = {
        id: data.chatbot.id,
        name: data.chatbot.name,
        widgetId: data.chatbot.widgetId,
        agentId: data.chatbot.agent.id,
        agentName: data.chatbot.agent.name,
        agentStatus: data.chatbot.agent.status,
        allowedDomains: data.chatbot.allowedDomains,
        primaryColor: data.chatbot.primaryColor,
        welcomeMessage: data.chatbot.welcomeMessage,
        isActive: data.chatbot.isActive,
        maxAiMessages: data.chatbot.maxAiMessages,
        aiRepliesEnabled: data.chatbot.aiRepliesEnabled,
        replyMode: data.chatbot.replyMode,
        fallbackDelaySeconds: data.chatbot.fallbackDelaySeconds,
        additionalPrompt: data.chatbot.additionalPrompt,
        avatarUrl: data.chatbot.avatarUrl,
        conversationStarters: data.chatbot.conversationStarters,
        widgetPosition: data.chatbot.widgetPosition,
        requireName: data.chatbot.requireName,
        requireEmail: data.chatbot.requireEmail,
        requirePhone: data.chatbot.requirePhone,
        emailNotifications: data.chatbot.emailNotifications,
      };

      setChatbots((current) => [nextChatbot, ...current]);
      setForm(emptyChatbotForm);
      setSuccess("Chatbot created successfully.");
      setDrawerOpen(false);
      router.push(`/dashboard/chatbots/${nextChatbot.id}`);
    } catch {
      setDrawerError(
        "Something went wrong while creating your chatbot. Check your connection and try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(chatbotId: string) {
    const shouldDelete = window.confirm(
      "Delete this chatbot? This action cannot be undone.",
    );

    if (!shouldDelete) {
      return;
    }

    setDeletingId(chatbotId);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/chatbots/${chatbotId}`, {
        method: "DELETE",
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to delete the chatbot.");
        setDeletingId("");
        return;
      }

      setChatbots((current) =>
        current.filter((chatbot) => chatbot.id !== chatbotId),
      );
    } catch {
      setError("Something went wrong while deleting the chatbot.");
    } finally {
      setDeletingId("");
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setSuccess("Embed snippet copied.");
    } catch {
      setError("Unable to copy the embed snippet.");
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="mx-auto max-w-[1080px]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-[2.25rem] font-semibold leading-none text-white">
              Chatbots
            </h1>
            <p className="mt-3 text-sm text-slate-400">
              Manage and configure your chatbot widgets.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="inline-flex h-11 items-center rounded-xl border border-white/10 bg-[#111111] px-4">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search chatbots..."
                aria-label="Search chatbots"
                className="w-[220px] bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
              />
            </div>

            <button
              type="button"
              onClick={openDrawer}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
            >
              <span className="mr-2 text-lg leading-none">+</span>
              New Chatbot
            </button>
          </div>
        </div>

        {error ? (
          <p className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {success}
          </p>
        ) : null}

        <div className="mt-8 space-y-5">
          {filteredChatbots.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-white/10 bg-[#0a0a0a] px-6 py-12 text-center text-sm text-slate-400">
              {chatbots.length === 0
                ? "No chatbots yet. Click New Chatbot to create your first website widget."
                : "No chatbots match the current search. Try a different name, agent or domain."}
            </div>
          ) : (
            filteredChatbots.map((chatbot) => {
              const embedSnippet = buildEmbedSnippet({
                widgetId: chatbot.widgetId,
                baseUrl,
                position: chatbot.widgetPosition,
              });

              return (
                <article
                  key={chatbot.id}
                  className="rounded-[28px] border border-white/10 bg-[#0a0a0a] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
                >
                  <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-4">
                          {chatbot.avatarUrl ? (
                            <img
                              src={chatbot.avatarUrl}
                              alt=""
                              className="h-14 w-14 shrink-0 rounded-full border border-white/10 object-cover"
                            />
                          ) : (
                            <div
                              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-semibold text-white"
                              style={{ backgroundColor: chatbot.primaryColor }}
                            >
                              {getChatbotInitial(chatbot.name)}
                            </div>
                          )}

                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-3">
                              <p className="truncate text-[1.8rem] font-semibold leading-none text-white">
                                {chatbot.name}
                              </p>
                              {chatbot.isActive ? null : (
                                <span className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200">
                                  Paused
                                </span>
                              )}
                            </div>
                            <p className="mt-2 text-sm text-slate-400">
                              Agent: {chatbot.agentName}
                              {chatbot.agentStatus === "ACTIVE" ? null : (
                                <span className="ml-1 text-amber-300">
                                  (Draft — won&apos;t reply)
                                </span>
                              )}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Widget ID: {chatbot.widgetId}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dashboard/chatbots/${chatbot.id}`}
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#171717]"
                            aria-label="Edit chatbot"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-4.5 w-4.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                            >
                              <path d="m4 20 4.5-1 8-8-3.5-3.5-8 8L4 20Z" />
                              <path d="m11.5 6.5 3.5 3.5" />
                            </svg>
                          </Link>
                          <IconButton
                            label="Delete chatbot"
                            disabled={deletingId === chatbot.id}
                            onClick={() => void handleDelete(chatbot.id)}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-4.5 w-4.5 text-red-400"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                            >
                              <path d="M5 7h14" />
                              <path d="M9 7V5.5h6V7" />
                              <path d="M8.5 7 9 19h6l.5-12" />
                            </svg>
                          </IconButton>
                        </div>
                      </div>

                      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1fr]">
                        <div>
                          <SectionLabel
                            title="Domains"
                            icon={
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <circle cx="12" cy="12" r="8" />
                                <path d="M4 12h16M12 4a14.5 14.5 0 0 1 0 16M12 4a14.5 14.5 0 0 0 0 16" />
                              </svg>
                            }
                          />
                          <div className="flex flex-wrap gap-2">
                            {chatbot.allowedDomains.map((domain) => (
                              <span
                                key={`${chatbot.id}-${domain}`}
                                className="rounded-lg border border-white/10 bg-[#111111] px-3 py-1 text-xs text-white"
                              >
                                {domain}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div>
                          <SectionLabel
                            title="Configuration"
                            icon={
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4" />
                              </svg>
                            }
                          />
                          <div className="space-y-3 text-sm text-slate-300">
                            <div className="flex items-center gap-3">
                              <span
                                className="h-3 w-3 rounded-full"
                                style={{ backgroundColor: chatbot.primaryColor }}
                              />
                              <span>{chatbot.primaryColor}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Position</span>
                              <span className="rounded-lg bg-[#1b1b1b] px-3 py-1 text-xs font-semibold text-white">
                                {formatWidgetPositionLabel(chatbot.widgetPosition)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">AI replies</span>
                              <span className="text-white">
                                {chatbot.aiRepliesEnabled
                                  ? formatReplyModeLabel(chatbot.replyMode)
                                  : "Disabled"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-8">
                        <SectionLabel
                          title="Welcome Message"
                          icon={
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M6 7.5h12A1.5 1.5 0 0 1 19.5 9v6A1.5 1.5 0 0 1 18 16.5H11l-4.5 3V16.5H6A1.5 1.5 0 0 1 4.5 15V9A1.5 1.5 0 0 1 6 7.5Z" />
                            </svg>
                          }
                        />
                        <p className="text-sm leading-7 text-slate-300">
                          {chatbot.welcomeMessage || defaultChatbotWelcomeMessage}
                        </p>
                      </div>

                      <div className="mt-8">
                        <SectionLabel
                          title="Embed to Website"
                          icon={
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="m9 8-4 4 4 4M15 8l4 4-4 4" />
                            </svg>
                          }
                        />
                        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#243043]">
                          <button
                            type="button"
                            onClick={() => void handleCopy(embedSnippet)}
                            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 transition hover:bg-white/5"
                            aria-label="Copy embed snippet"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-4.5 w-4.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                            >
                              <rect x="9" y="9" width="10" height="10" rx="2" />
                              <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>
                          <pre className="overflow-x-auto px-4 py-5 pr-16 text-xs leading-6 text-white">
                            <code>{embedSnippet}</code>
                          </pre>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>

      <div
        inert={!drawerOpen}
        className={`fixed inset-0 z-50 transition ${
          drawerOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <button
          type="button"
          onClick={closeDrawer}
          aria-label="Close chatbot drawer"
          className={`absolute inset-0 bg-black/60 transition ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
        />

        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-chatbot-title"
          className={`absolute right-0 top-0 flex h-full w-full max-w-[500px] flex-col border-l border-white/10 bg-[#090909] shadow-[-20px_0_60px_rgba(0,0,0,0.45)] transition ${
            drawerOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-6 pb-5 pt-6">
            <div>
              <p id="new-chatbot-title" className="text-[1.75rem] font-semibold text-white">
                New Chatbot
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Create the widget shell here, then fine-tune responses and
                fields on the full configuration page.
              </p>
            </div>
            <IconButton label="Close drawer" disabled={isSaving} onClick={closeDrawer}>
              <svg
                viewBox="0 0 24 24"
                className="h-4.5 w-4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </IconButton>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6">
            <div>
              <label
                htmlFor="new-chatbot-name"
                className="mb-2 block text-sm font-medium text-white"
              >
                Chatbot Name
              </label>
              <input
                id="new-chatbot-name"
                type="text"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="e.g. Website Chat"
                className="h-12 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none transition focus:border-white"
              />
            </div>

            <div>
              <label
                htmlFor="new-chatbot-agent"
                className="mb-2 block text-sm font-medium text-white"
              >
                AI Agent
              </label>
              <select
                id="new-chatbot-agent"
                value={form.agentId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, agentId: event.target.value }))
                }
                className="h-12 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none"
              >
                <option value="">Select an AI Agent</option>
                {agentOptions.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.status === "ACTIVE"
                      ? agent.name
                      : `${agent.name} (Draft — won't reply)`}
                  </option>
                ))}
              </select>
              {selectedAgent && selectedAgent.status !== "ACTIVE" ? (
                <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  This agent is not published, so the widget will only show an
                  offline message. Publish it from AI Agents → Settings.
                </p>
              ) : null}
              {agentOptions.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">
                  No AI agents yet.{" "}
                  <Link href="/dashboard/ai-agents" className="text-white underline">
                    Create one under AI Agents
                  </Link>{" "}
                  first.
                </p>
              ) : null}
            </div>

            <div>
              <label
                htmlFor="new-chatbot-domain"
                className="mb-2 block text-sm font-medium text-white"
              >
                Allowed Domains
              </label>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  id="new-chatbot-domain"
                  type="text"
                  value={form.domainInput}
                  onChange={(event) => {
                    setForm((current) => ({
                      ...current,
                      domainInput: event.target.value,
                    }));
                    setDomainError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addDomain();
                    }
                  }}
                  placeholder="example.com"
                  aria-invalid={domainError ? true : undefined}
                  aria-describedby="new-chatbot-domain-help"
                  className={`h-12 w-full rounded-xl border bg-[#111111] px-4 text-sm text-white outline-none transition focus:border-white ${
                    domainError ? "border-red-500/60" : "border-white/10"
                  }`}
                />
                <button
                  type="button"
                  onClick={addDomain}
                  className="h-12 rounded-xl border border-white/10 bg-[#151515] px-4 text-sm font-semibold text-white transition hover:bg-[#1d1d1d]"
                >
                  Add Domain
                </button>
              </div>

              <div id="new-chatbot-domain-help">
                {domainError ? (
                  <p className="mt-2 text-sm text-red-300">{domainError}</p>
                ) : null}
                <p className="mt-2 text-sm text-slate-400">{allowedDomainsHelpText}</p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {form.allowedDomains.map((domain) => (
                  <button
                    key={domain}
                    type="button"
                    onClick={() => removeDomain(domain)}
                    aria-label={`Remove ${domain}`}
                    className="rounded-full border border-white/10 bg-[#151515] px-3 py-1 text-xs text-slate-300 transition hover:border-red-400/40 hover:text-red-200"
                  >
                    {domain} x
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-3 block text-sm font-medium text-white">
                Primary Color
              </p>
              <div className="flex flex-wrap gap-3">
                {chatbotColorOptions.map((color) => {
                  const isSelected = form.primaryColor === color;

                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          primaryColor: color,
                        }))
                      }
                      aria-label={`Use color ${color}`}
                      aria-pressed={isSelected}
                      className={`flex h-11 w-11 items-center justify-center rounded-full border-2 transition ${
                        isSelected ? "border-white" : "border-transparent"
                      }`}
                      style={{ backgroundColor: color }}
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

            <div>
              <label
                htmlFor="new-chatbot-welcome"
                className="mb-2 block text-sm font-medium text-white"
              >
                Welcome Message
              </label>
              <textarea
                id="new-chatbot-welcome"
                value={form.welcomeMessage}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    welcomeMessage: event.target.value,
                  }))
                }
                className="min-h-[140px] w-full rounded-2xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white"
              />
            </div>
          </div>

          <div className="shrink-0 border-t border-white/10 px-6 pb-6 pt-5">
            {drawerError ? (
              <p
                role="alert"
                className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
              >
                {drawerError}
              </p>
            ) : null}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={isSaving}
                onClick={closeDrawer}
                className="h-11 rounded-xl border border-white/10 bg-[#111111] px-4 text-sm font-medium text-white transition hover:bg-[#171717] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleCreateChatbot()}
                className="h-11 rounded-xl bg-white px-5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
              >
                {isSaving ? "Creating..." : "Create Chatbot"}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
