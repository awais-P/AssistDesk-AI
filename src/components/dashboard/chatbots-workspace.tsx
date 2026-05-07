"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  chatbotColorOptions,
  defaultChatbotWelcomeMessage,
} from "@/src/lib/chatbot-config";

type ChatbotItem = {
  id: string;
  name: string;
  widgetId: string;
  agentId: string;
  agentName: string;
  allowedDomains: string[];
  primaryColor: string;
  welcomeMessage: string | null;
  isActive: boolean;
  maxAiMessages: number;
};

type AgentOption = {
  id: string;
  name: string;
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
  primaryColor: "#4f8cff",
  maxAiMessages: 20,
};

export function ChatbotsWorkspace({
  initialChatbots,
  agentOptions,
}: ChatbotsWorkspaceProps) {
  const router = useRouter();
  const [chatbots, setChatbots] = useState(initialChatbots);
  const [search, setSearch] = useState("");
  const [menuOpenId, setMenuOpenId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(emptyChatbotForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");

  useEffect(() => {
    function handleWindowClick() {
      setMenuOpenId("");
    }

    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

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
    setForm(emptyChatbotForm);
    setDrawerOpen(true);
    setError("");
    setSuccess("");
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setError("");
    setSuccess("");
  }

  function addDomain() {
    const nextDomain = form.domainInput.trim();

    if (!nextDomain || form.allowedDomains.includes(nextDomain)) {
      setForm((current) => ({ ...current, domainInput: "" }));
      return;
    }

    setForm((current) => ({
      ...current,
      allowedDomains: [...current.allowedDomains, nextDomain],
      domainInput: "",
    }));
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
          allowedDomains: form.allowedDomains,
          primaryColor: form.primaryColor,
          welcomeMessage: form.welcomeMessage,
          maxAiMessages: form.maxAiMessages,
          isActive: true,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        chatbot?: {
          id: string;
          name: string;
          widgetId: string;
          allowedDomains: string[];
          primaryColor: string;
          welcomeMessage: string | null;
          isActive: boolean;
          maxAiMessages: number;
          agent: {
            id: string;
            name: string;
          };
        };
      };

      if (!response.ok || !data.chatbot) {
        setError(data.error ?? "Unable to create the chatbot right now.");
        setIsSaving(false);
        return;
      }

      const nextChatbot: ChatbotItem = {
        id: data.chatbot.id,
        name: data.chatbot.name,
        widgetId: data.chatbot.widgetId,
        agentId: data.chatbot.agent.id,
        agentName: data.chatbot.agent.name,
        allowedDomains: data.chatbot.allowedDomains,
        primaryColor: data.chatbot.primaryColor,
        welcomeMessage: data.chatbot.welcomeMessage,
        isActive: data.chatbot.isActive,
        maxAiMessages: data.chatbot.maxAiMessages,
      };

      setChatbots((current) => [nextChatbot, ...current]);
      setSuccess("Chatbot created successfully.");
      setDrawerOpen(false);
      router.push(`/dashboard/chatbots/${nextChatbot.id}`);
    } catch {
      setError("Something went wrong while creating the chatbot.");
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
    setMenuOpenId("");

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

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
            Chatbots
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Manage your web chatbot widgets, linked AI agents, allowed domains,
            and embed-ready configuration in one workspace.
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

          <button
            type="button"
            onClick={openDrawer}
            className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
          >
            + Create Chatbot
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

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {filteredChatbots.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-[#0a0a0a] px-5 py-8 text-sm text-slate-400">
            No chatbots match the current search. Create one to configure your
            website widget.
          </div>
        ) : (
          filteredChatbots.map((chatbot) => (
            <article
              key={chatbot.id}
              className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-4 transition hover:border-white/20 hover:bg-[#111111]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold text-white"
                    style={{ backgroundColor: chatbot.primaryColor }}
                  >
                    W
                  </div>
                  <div>
                    <p className="text-base font-semibold text-white">
                      {chatbot.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Agent: {chatbot.agentName}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Widget ID: {chatbot.widgetId}
                    </p>
                  </div>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuOpenId((current) =>
                        current === chatbot.id ? "" : chatbot.id,
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

                  {menuOpenId === chatbot.id ? (
                    <div
                      className="absolute right-0 top-11 z-20 min-w-[150px] rounded-xl border border-white/10 bg-[#0f0f0f] p-1.5 shadow-[0_14px_32px_rgba(0,0,0,0.45)]"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Link
                        href={`/dashboard/chatbots/${chatbot.id}`}
                        className="block rounded-lg px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5"
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        disabled={deletingId === chatbot.id}
                        onClick={() => handleDelete(chatbot.id)}
                        className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-200 transition hover:bg-red-500/10 disabled:opacity-60"
                      >
                        {deletingId === chatbot.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-[#0f0f0f] p-4">
                <div className="flex min-h-[118px] flex-col justify-between rounded-2xl border border-white/10 bg-[#090909] p-4">
                  <div
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: chatbot.primaryColor }}
                  >
                    A
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {chatbot.welcomeMessage || defaultChatbotWelcomeMessage}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Max AI Messages: {chatbot.maxAiMessages}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300">
                  {chatbot.isActive ? "Active" : "Inactive"}
                </span>
                {chatbot.allowedDomains.slice(0, 2).map((domain) => (
                  <span
                    key={`${chatbot.id}-${domain}`}
                    className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300"
                  >
                    {domain}
                  </span>
                ))}
                {chatbot.allowedDomains.length > 2 ? (
                  <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300">
                    +{chatbot.allowedDomains.length - 2} more
                  </span>
                ) : null}
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">Web widget ready</p>
                <Link
                  href={`/dashboard/chatbots/${chatbot.id}`}
                  className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#1a1a1a]"
                >
                  Open Chatbot
                </Link>
              </div>
            </article>
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
          aria-label="Close chatbot drawer"
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
              <p className="text-xl font-semibold text-white">Create Chatbot</p>
              <p className="mt-1 text-sm text-slate-400">
                Create a widget, connect an AI agent, and continue into the
                detailed chatbot page.
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

          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Chatbot Name
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Linked AI Agent
              </label>
              <select
                value={form.agentId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, agentId: event.target.value }))
                }
                className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none"
              >
                <option value="">Select an AI Agent</option>
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
                value={form.welcomeMessage}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    welcomeMessage: event.target.value,
                  }))
                }
                className="min-h-[120px] w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Allowed Domains
              </label>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  type="text"
                  value={form.domainInput}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      domainInput: event.target.value,
                    }))
                  }
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
              <div className="mt-3 flex flex-wrap gap-2">
                {form.allowedDomains.map((domain) => (
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

            <div>
              <label className="mb-3 block text-sm font-medium text-slate-300">
                Widget Color
              </label>
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
                onClick={() => void handleCreateChatbot()}
                className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
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
