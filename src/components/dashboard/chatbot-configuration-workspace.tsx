"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildEmbedSnippet,
  chatbotColorOptions,
  defaultChatbotWelcomeMessage,
} from "@/src/lib/chatbot-config";

type AgentOption = {
  id: string;
  name: string;
};

type ChatbotConfigurationWorkspaceProps = {
  chatbot: {
    id: string;
    name: string;
    widgetId: string;
    agentId: string;
    allowedDomains: string[];
    primaryColor: string;
    welcomeMessage: string | null;
    isActive: boolean;
    maxAiMessages: number;
  };
  agentOptions: AgentOption[];
};

export function ChatbotConfigurationWorkspace({
  chatbot,
  agentOptions,
}: ChatbotConfigurationWorkspaceProps) {
  const router = useRouter();
  const [name, setName] = useState(chatbot.name);
  const [agentId, setAgentId] = useState(chatbot.agentId);
  const [welcomeMessage, setWelcomeMessage] = useState(
    chatbot.welcomeMessage || defaultChatbotWelcomeMessage,
  );
  const [primaryColor, setPrimaryColor] = useState(chatbot.primaryColor);
  const [allowedDomains, setAllowedDomains] = useState(chatbot.allowedDomains);
  const [domainInput, setDomainInput] = useState("");
  const [isActive, setIsActive] = useState(chatbot.isActive);
  const [maxAiMessages, setMaxAiMessages] = useState(chatbot.maxAiMessages);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  function addDomain() {
    const nextDomain = domainInput.trim();

    if (!nextDomain || allowedDomains.includes(nextDomain)) {
      setDomainInput("");
      return;
    }

    setAllowedDomains((current) => [...current, nextDomain]);
    setDomainInput("");
  }

  function removeDomain(domain: string) {
    setAllowedDomains((current) => current.filter((item) => item !== domain));
  }

  async function handleSave() {
    setError("");
    setSuccess("");
    setIsSaving(true);

    try {
      const response = await fetch("/api/chatbots", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: chatbot.id,
          name,
          agentId,
          allowedDomains,
          primaryColor,
          welcomeMessage,
          isActive,
          maxAiMessages,
        }),
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to save chatbot changes.");
        setIsSaving(false);
        return;
      }

      setSuccess("Chatbot updated successfully.");
    } catch {
      setError("Something went wrong while saving the chatbot.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    const shouldDelete = window.confirm(
      "Delete this chatbot? This action cannot be undone.",
    );

    if (!shouldDelete) {
      return;
    }

    setError("");
    setSuccess("");
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/chatbots/${chatbot.id}`, {
        method: "DELETE",
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to delete the chatbot.");
        setIsDeleting(false);
        return;
      }

      router.push("/dashboard/chatbots");
    } catch {
      setError("Something went wrong while deleting the chatbot.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="mx-auto max-w-[980px]">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Chatbot Configuration
            </p>
            <h1 className="heading-font mt-2 text-[2rem] font-bold leading-none text-white">
              {chatbot.name}
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-400">
              Refine the widget appearance, linked agent, domains, activity
              state, and embed details for this chatbot.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
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

        <div className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
              <p className="text-base font-semibold text-white">
                Widget Overview
              </p>
              <div className="mt-4 rounded-2xl border border-white/10 bg-[#0f0f0f] p-5">
                <div className="flex min-h-[180px] flex-col justify-between rounded-2xl border border-white/10 bg-[#090909] p-5">
                  <div
                    className="inline-flex h-12 w-12 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: primaryColor }}
                  >
                    A
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-white">{name}</p>
                    <p className="mt-2 text-sm text-slate-300">
                      {welcomeMessage || defaultChatbotWelcomeMessage}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300">
                        {isActive ? "Active" : "Inactive"}
                      </span>
                      <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300">
                        {maxAiMessages} max AI messages
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
              <p className="text-base font-semibold text-white">
                Basic Configuration
              </p>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Chatbot Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Linked AI Agent
                  </label>
                  <select
                    value={agentId}
                    onChange={(event) => setAgentId(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none"
                  >
                    {agentOptions.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Welcome Message
                  </label>
                  <textarea
                    value={welcomeMessage}
                    onChange={(event) => setWelcomeMessage(event.target.value)}
                    className="min-h-[140px] w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-white">
                    Widget Activity
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    Control whether this chatbot is live on your website.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsActive((current) => !current)}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition ${
                    isActive ? "bg-white" : "bg-white/10"
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 rounded-full bg-[#050505] transition ${
                      isActive ? "translate-x-7" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-300">
                    Max AI Messages
                  </label>
                  <span className="text-sm text-slate-400">
                    {maxAiMessages}
                  </span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  value={maxAiMessages}
                  onChange={(event) =>
                    setMaxAiMessages(Number(event.target.value))
                  }
                  className="w-full accent-white"
                />
              </div>
            </div>
          </section>

          <section className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
              <p className="text-base font-semibold text-white">Appearance</p>
              <p className="mt-2 text-sm text-slate-400">
                Choose the primary widget color used for the launcher and key UI
                elements.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {chatbotColorOptions.map((color) => {
                  const isSelected = primaryColor === color;

                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setPrimaryColor(color)}
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

            <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
              <p className="text-base font-semibold text-white">
                Allowed Domains
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  type="text"
                  value={domainInput}
                  onChange={(event) => setDomainInput(event.target.value)}
                  placeholder="https://example.com"
                  className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                />
                <button
                  type="button"
                  onClick={addDomain}
                  className="pressable inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#161616] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1d1d1d]"
                >
                  Add
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {allowedDomains.map((domain) => (
                  <button
                    key={domain}
                    type="button"
                    onClick={() => removeDomain(domain)}
                    className="pressable rounded-full border border-white/10 bg-[#151515] px-3 py-1 text-xs text-slate-300 transition hover:border-red-400/40 hover:text-red-200"
                  >
                    {domain} ×
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
              <p className="text-base font-semibold text-white">Embed Details</p>
              <div className="mt-4 rounded-xl border border-white/10 bg-[#111111] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Widget ID
                </p>
                <p className="mt-2 text-sm text-white">{chatbot.widgetId}</p>
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Embed Snippet
                </label>
                <textarea
                  readOnly
                  value={buildEmbedSnippet(chatbot.widgetId)}
                  className="min-h-[170px] w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-slate-300 outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDelete}
                className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-60"
              >
                {isDeleting ? "Deleting..." : "Delete Chatbot"}
              </button>

              <button
                type="button"
                disabled={isSaving}
                onClick={handleSave}
                className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
