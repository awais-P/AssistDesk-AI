"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ChatbotWidgetPreview } from "@/src/components/dashboard/chatbot-widget-preview";
import {
  allowedDomainsHelpText,
  avatarMimeTypes,
  buildEmbedSnippet,
  chatbotColorOptions,
  chatbotReplyModeOptions,
  defaultChatbotWelcomeMessage,
  defaultFallbackDelaySeconds,
  formatWidgetPositionLabel,
  getChatbotInitial,
  isValidHexColor,
  maxAiMessagesLimit,
  maxAvatarBytes,
  maxConversationStarterLength,
  maxConversationStarters,
  maxFallbackDelaySeconds,
  minFallbackDelaySeconds,
  parseChatbotDomainInput,
  widgetPositionOptions,
} from "@/src/lib/chatbot-config";

type AgentOption = {
  id: string;
  name: string;
  status: string;
};

type ChatbotConfigurationWorkspaceProps = {
  chatbot: {
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
    widgetPosition: "BOTTOM_RIGHT" | "BOTTOM_LEFT";
    requireName: boolean;
    requireEmail: boolean;
    requirePhone: boolean;
    emailNotifications: boolean;
  };
  agentOptions: AgentOption[];
};

function AccordionSection({
  title,
  icon,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  icon: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#090909]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-slate-300">{icon}</span>
          <span className="text-lg font-semibold text-white">{title}</span>
        </div>
        <svg
          viewBox="0 0 24 24"
          className={`h-5 w-5 text-slate-400 transition ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {isOpen ? <div className="border-t border-white/10 px-5 py-5">{children}</div> : null}
    </section>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (nextValue: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-[#111111] px-4 py-4">
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm text-slate-400">{description}</p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${
          checked ? "bg-emerald-400" : "bg-white/10"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-[#050505] transition ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

export function ChatbotConfigurationWorkspace({
  chatbot,
  agentOptions,
}: ChatbotConfigurationWorkspaceProps) {
  const router = useRouter();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [baseUrl, setBaseUrl] = useState("http://localhost:3000");
  const [openSections, setOpenSections] = useState({
    basic: true,
    ai: true,
    appearance: true,
    messages: true,
    notifications: true,
  });
  const [name, setName] = useState(chatbot.name);
  const [agentId, setAgentId] = useState(chatbot.agentId);
  const [allowedDomains, setAllowedDomains] = useState(chatbot.allowedDomains);
  const [domainInput, setDomainInput] = useState("");
  const [domainError, setDomainError] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState(
    chatbot.welcomeMessage || defaultChatbotWelcomeMessage,
  );
  const [primaryColor, setPrimaryColor] = useState(chatbot.primaryColor);
  const [avatarUrl, setAvatarUrl] = useState(chatbot.avatarUrl);
  const [avatarError, setAvatarError] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [conversationStarters, setConversationStarters] = useState(
    chatbot.conversationStarters,
  );
  const [isActive, setIsActive] = useState(chatbot.isActive);
  const [maxAiMessages, setMaxAiMessages] = useState(String(chatbot.maxAiMessages));
  const [aiRepliesEnabled, setAiRepliesEnabled] = useState(chatbot.aiRepliesEnabled);
  const [replyMode, setReplyMode] = useState(chatbot.replyMode);
  const [fallbackDelaySeconds, setFallbackDelaySeconds] = useState(
    String(chatbot.fallbackDelaySeconds || defaultFallbackDelaySeconds),
  );
  const [additionalPrompt, setAdditionalPrompt] = useState(
    chatbot.additionalPrompt || "",
  );
  const [widgetPosition, setWidgetPosition] = useState(chatbot.widgetPosition);
  const [requireName, setRequireName] = useState(chatbot.requireName);
  const [requireEmail, setRequireEmail] = useState(chatbot.requireEmail);
  const [requirePhone, setRequirePhone] = useState(chatbot.requirePhone);
  const [emailNotifications, setEmailNotifications] = useState(
    chatbot.emailNotifications,
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  useEffect(() => {
    setBaseUrl(window.location.origin);
  }, []);

  const selectedAgent = useMemo(() => {
    return agentOptions.find((agent) => agent.id === agentId);
  }, [agentId, agentOptions]);

  const selectedAgentName = selectedAgent?.name || chatbot.agentName;
  const selectedAgentStatus = selectedAgent?.status || chatbot.agentStatus;

  const embedSnippet = useMemo(() => {
    return buildEmbedSnippet({
      widgetId: chatbot.widgetId,
      baseUrl,
      position: widgetPosition,
    });
  }, [baseUrl, chatbot.widgetId, widgetPosition]);

  const isPrimaryColorValid = isValidHexColor(primaryColor);
  const maxAiMessagesValue = Number(maxAiMessages);
  const maxAiMessagesError =
    !Number.isInteger(maxAiMessagesValue) ||
    maxAiMessagesValue < 1 ||
    maxAiMessagesValue > maxAiMessagesLimit
      ? `Enter a whole number between 1 and ${maxAiMessagesLimit}.`
      : "";
  const fallbackDelayValue = Number(fallbackDelaySeconds);
  const fallbackDelayError =
    !Number.isInteger(fallbackDelayValue) ||
    fallbackDelayValue < minFallbackDelaySeconds ||
    fallbackDelayValue > maxFallbackDelaySeconds
      ? `Enter a whole number of seconds between ${minFallbackDelaySeconds} and ${maxFallbackDelaySeconds}.`
      : "";

  function toggleSection(section: keyof typeof openSections) {
    setOpenSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }

  function addDomain() {
    const result = parseChatbotDomainInput(domainInput, allowedDomains);

    if (result.error !== undefined) {
      setDomainError(result.error);
      return;
    }

    setAllowedDomains((current) => [...current, result.domain]);
    setDomainInput("");
    setDomainError("");
  }

  function removeDomain(domain: string) {
    setAllowedDomains((current) => current.filter((item) => item !== domain));
  }

  function updateConversationStarter(index: number, value: string) {
    setConversationStarters((current) =>
      current.map((starter, starterIndex) =>
        starterIndex === index ? value.slice(0, maxConversationStarterLength) : starter,
      ),
    );
  }

  function addConversationStarter() {
    setConversationStarters((current) =>
      current.length >= maxConversationStarters ? current : [...current, ""],
    );
  }

  function removeConversationStarter(index: number) {
    setConversationStarters((current) =>
      current.filter((_, starterIndex) => starterIndex !== index),
    );
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setAvatarError("");

    if (!avatarMimeTypes.includes(file.type)) {
      setAvatarError("This file type is not supported. Choose a PNG, JPG, GIF or WebP image.");
      return;
    }

    if (file.size > maxAvatarBytes) {
      setAvatarError("This image is larger than 1 MB. Resize or compress it and try again.");
      return;
    }

    setIsUploadingAvatar(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/uploads/avatar", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !data.url) {
        setAvatarError(data.error ?? "Unable to upload this image. Try a different file.");
        return;
      }

      setAvatarUrl(data.url);
      setSuccess("Avatar uploaded. Click Save Changes to apply it to the widget.");
      setError("");
    } catch {
      setAvatarError(
        "Something went wrong while uploading the avatar. Check your connection and try again.",
      );
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  async function handleSave() {
    setError("");
    setSuccess("");

    if (!name.trim()) {
      setError("Give the chatbot a name before saving.");
      return;
    }

    if (allowedDomains.length === 0) {
      setError("Add at least one allowed domain, for example example.com, before saving.");
      return;
    }

    if (!isPrimaryColorValid) {
      setError("Primary color must be a hex color like #3b82f6. Fix it in Appearance and save again.");
      return;
    }

    if (maxAiMessagesError) {
      setError(`Max Messages limit: ${maxAiMessagesError}`);
      return;
    }

    if (replyMode === "FALLBACK" && fallbackDelayError) {
      setError(`Fallback delay: ${fallbackDelayError}`);
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
          id: chatbot.id,
          name,
          agentId,
          allowedDomains,
          primaryColor,
          welcomeMessage,
          isActive,
          maxAiMessages: maxAiMessagesValue,
          aiRepliesEnabled,
          replyMode,
          fallbackDelaySeconds: fallbackDelayError
            ? chatbot.fallbackDelaySeconds
            : fallbackDelayValue,
          additionalPrompt,
          avatarUrl,
          conversationStarters: conversationStarters
            .map((starter) => starter.trim())
            .filter(Boolean),
          widgetPosition,
          requireName,
          requireEmail,
          requirePhone,
          emailNotifications,
        }),
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to save chatbot changes. Please try again.");
        return;
      }

      setSuccess("Chatbot updated successfully.");
    } catch {
      setError(
        "Something went wrong while saving the chatbot. Check your connection and try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleActive() {
    const nextIsActive = !isActive;

    setError("");
    setSuccess("");
    setIsTogglingActive(true);

    try {
      const response = await fetch(`/api/chatbots/${chatbot.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isActive: nextIsActive }),
      });

      const data = (await response.json()) as { error?: string; isActive?: boolean };

      if (!response.ok) {
        setError(
          data.error ??
            `Unable to ${nextIsActive ? "reactivate" : "pause"} the widget. Please try again.`,
        );
        return;
      }

      setIsActive(data.isActive ?? nextIsActive);
      setSuccess(
        nextIsActive
          ? "Widget reactivated. Visitors can start chats again."
          : "Widget paused. Visitors will no longer see the chat until you reactivate it.",
      );
    } catch {
      setError(
        "Something went wrong while updating the widget status. Check your connection and try again.",
      );
    } finally {
      setIsTogglingActive(false);
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

  async function handleCopySnippet() {
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setSuccess("Embed snippet copied.");
      setError("");
    } catch {
      setError("Unable to copy the embed snippet. Select the code and copy it manually.");
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="mx-auto max-w-[1240px]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-[2.2rem] font-semibold leading-none text-white">
              Chatbot
            </h1>
            <p className="mt-3 text-sm text-slate-400">
              Configure and customize your chatbot widget.
            </p>
          </div>

          <button
            type="button"
            disabled={isSaving || isUploadingAvatar}
            onClick={() => void handleSave()}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
          >
            <svg
              viewBox="0 0 24 24"
              className="mr-2 h-4.5 w-4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M6 4.5h9l3 3V19.5H6z" />
              <path d="M9 4.5v5h6v-2" />
              <path d="M9 15h6" />
            </svg>
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
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

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_420px]">
          <div className="space-y-4">
            <AccordionSection
              title="Basic Information"
              isOpen={openSections.basic}
              onToggle={() => toggleSection("basic")}
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 3.5 4.5 7v5c0 4.3 2.7 7.6 7.5 8.5 4.8-.9 7.5-4.2 7.5-8.5V7L12 3.5Z" />
                  <path d="M9.5 12h5" />
                  <path d="M12 9.5v5" />
                </svg>
              }
            >
              <div className="space-y-5">
                <div>
                  <label
                    htmlFor="chatbot-name"
                    className="mb-2 block text-sm font-medium text-white"
                  >
                    Name *
                  </label>
                  <input
                    id="chatbot-name"
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="h-12 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none transition focus:border-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="chatbot-domain-input"
                    className="mb-2 block text-sm font-medium text-white"
                  >
                    Allowed Domains *
                  </label>
                  <div className="space-y-3">
                    {allowedDomains.map((domain) => (
                      <div
                        key={domain}
                        className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#111111] px-4 py-3"
                      >
                        <input
                          type="text"
                          value={domain}
                          readOnly
                          aria-label={`Allowed domain ${domain}`}
                          className="w-full bg-transparent text-sm text-white outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => removeDomain(domain)}
                          className="text-slate-500 transition hover:text-red-300"
                          aria-label={`Remove ${domain}`}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="h-4.5 w-4.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          >
                            <path d="M5 7h14" />
                            <path d="M9 7V5.5h6V7" />
                            <path d="M8.5 7 9 19h6l.5-12" />
                          </svg>
                        </button>
                      </div>
                    ))}

                    <div className="flex flex-wrap gap-3">
                      <input
                        id="chatbot-domain-input"
                        type="text"
                        value={domainInput}
                        onChange={(event) => {
                          setDomainInput(event.target.value);
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
                        aria-describedby="chatbot-domain-help"
                        className={`h-11 min-w-[260px] flex-1 rounded-xl border bg-[#111111] px-4 text-sm text-white outline-none transition focus:border-white ${
                          domainError ? "border-red-500/60" : "border-white/10"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={addDomain}
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-[#111111] px-4 text-sm font-semibold text-white transition hover:bg-[#171717]"
                      >
                        <span className="mr-2 text-lg leading-none">+</span>
                        Add Domain
                      </button>
                    </div>

                    <div id="chatbot-domain-help">
                      {domainError ? (
                        <p className="text-sm text-red-300">{domainError}</p>
                      ) : null}
                      <p className="mt-1 text-sm text-slate-400">
                        {allowedDomainsHelpText}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </AccordionSection>

            <AccordionSection
              title="AI Responses"
              isOpen={openSections.ai}
              onToggle={() => toggleSection("ai")}
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8Z" />
                </svg>
              }
            >
              <div className="space-y-5">
                <ToggleRow
                  title="AI Responses Enabled"
                  description="Toggle AI responses on or off for this site."
                  checked={aiRepliesEnabled}
                  onChange={setAiRepliesEnabled}
                />

                <div>
                  <label
                    htmlFor="chatbot-agent"
                    className="mb-2 block text-sm font-medium text-white"
                  >
                    AI Agent
                  </label>
                  <select
                    id="chatbot-agent"
                    value={agentId}
                    onChange={(event) => setAgentId(event.target.value)}
                    className="h-12 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none"
                  >
                    {agentOptions.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.status === "ACTIVE"
                          ? agent.name
                          : `${agent.name} (Draft — won't reply)`}
                      </option>
                    ))}
                  </select>
                  {selectedAgentStatus !== "ACTIVE" ? (
                    <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                      This agent is not published, so the widget will only show
                      an offline message. Publish it from AI Agents → Settings.
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm text-slate-400">
                    Connect this chat widget to an AI agent that delivers
                    instant, 24x7 support using your own knowledge base and
                    training materials.
                  </p>
                </div>

                <div>
                  <p className="mb-3 block text-sm font-medium text-white">
                    Reply Mode
                  </p>
                  <div className="space-y-3" role="radiogroup" aria-label="Reply Mode">
                    {chatbotReplyModeOptions.map((option) => {
                      const isSelected = replyMode === option.value;
                      const description =
                        option.value === "FALLBACK"
                          ? option.description.replace(
                              "N seconds",
                              `${fallbackDelayError ? defaultFallbackDelaySeconds : fallbackDelayValue} seconds`,
                            )
                          : option.description;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => setReplyMode(option.value)}
                          className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                            isSelected
                              ? "border-white bg-[#111111]"
                              : "border-white/10 bg-[#0d0d0d] hover:border-white/20"
                          }`}
                        >
                          <div className="flex items-start gap-4">
                            <div
                              className={`mt-1 h-5 w-5 shrink-0 rounded-full border ${
                                isSelected
                                  ? "border-white bg-white"
                                  : "border-white/20"
                              }`}
                            >
                              {isSelected ? (
                                <div className="m-[3px] h-2.5 w-2.5 rounded-full bg-[#050505]" />
                              ) : null}
                            </div>
                            <div>
                              <p className="text-lg font-semibold text-white">
                                {option.label}
                              </p>
                              <p className="mt-1 text-sm text-slate-400">
                                {description}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {replyMode === "FALLBACK" ? (
                  <div>
                    <label
                      htmlFor="chatbot-fallback-delay"
                      className="mb-2 block text-sm font-medium text-white"
                    >
                      Fallback delay (seconds)
                    </label>
                    <input
                      id="chatbot-fallback-delay"
                      type="number"
                      min={minFallbackDelaySeconds}
                      max={maxFallbackDelaySeconds}
                      value={fallbackDelaySeconds}
                      onChange={(event) => setFallbackDelaySeconds(event.target.value)}
                      aria-invalid={fallbackDelayError ? true : undefined}
                      aria-describedby="chatbot-fallback-delay-help"
                      className={`h-12 w-full rounded-xl border bg-[#111111] px-4 text-sm text-white outline-none transition focus:border-white ${
                        fallbackDelayError ? "border-red-500/60" : "border-white/10"
                      }`}
                    />
                    <div id="chatbot-fallback-delay-help">
                      {fallbackDelayError ? (
                        <p className="mt-2 text-sm text-red-300">{fallbackDelayError}</p>
                      ) : null}
                      <p className="mt-2 text-sm text-slate-400">
                        How long to wait for a team member to reply before the AI
                        answers ({minFallbackDelaySeconds}–{maxFallbackDelaySeconds} seconds).
                      </p>
                    </div>
                  </div>
                ) : null}

                <div>
                  <label
                    htmlFor="chatbot-additional-prompt"
                    className="mb-2 block text-sm font-medium text-white"
                  >
                    Prompt (Additional instructions)
                  </label>
                  <textarea
                    id="chatbot-additional-prompt"
                    value={additionalPrompt}
                    onChange={(event) => setAdditionalPrompt(event.target.value)}
                    placeholder="You are an assistant. Be concise and helpful."
                    className="min-h-[132px] w-full rounded-2xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white"
                  />
                  <p className="mt-2 text-sm text-slate-400">
                    Optional: a custom system prompt to guide AI behavior or
                    site-specific instructions.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="chatbot-max-ai-messages"
                    className="mb-2 block text-sm font-medium text-white"
                  >
                    Max Messages limit
                  </label>
                  <input
                    id="chatbot-max-ai-messages"
                    type="number"
                    min="1"
                    max={maxAiMessagesLimit}
                    value={maxAiMessages}
                    onChange={(event) => setMaxAiMessages(event.target.value)}
                    placeholder="e.g. 100"
                    aria-invalid={maxAiMessagesError ? true : undefined}
                    className={`h-12 w-full rounded-xl border bg-[#111111] px-4 text-sm text-white outline-none transition focus:border-white ${
                      maxAiMessagesError ? "border-red-500/60" : "border-white/10"
                    }`}
                  />
                  {maxAiMessagesError ? (
                    <p className="mt-2 text-sm text-red-300">{maxAiMessagesError}</p>
                  ) : null}
                  <p className="mt-2 text-sm text-slate-400">
                    Maximum AI replies per session (up to {maxAiMessagesLimit}).
                  </p>
                </div>
              </div>
            </AccordionSection>

            <AccordionSection
              title="Appearance"
              isOpen={openSections.appearance}
              onToggle={() => toggleSection("appearance")}
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="7" />
                  <path d="M7 15.5a2.5 2.5 0 1 1 2.5 2.5H9a2 2 0 0 0-2 2" />
                </svg>
              }
            >
              <div className="space-y-5">
                <div>
                  <label
                    htmlFor="chatbot-avatar"
                    className="mb-2 block text-sm font-medium text-white"
                  >
                    Avatar
                  </label>
                  <div className="flex flex-wrap items-center gap-4">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt="Chatbot avatar"
                        className="h-14 w-14 rounded-full border border-white/10 object-cover"
                      />
                    ) : (
                      <span
                        className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 text-lg font-semibold text-white"
                        style={{
                          backgroundColor: isPrimaryColorValid
                            ? primaryColor
                            : chatbot.primaryColor,
                        }}
                      >
                        {getChatbotInitial(name || chatbot.name)}
                      </span>
                    )}

                    <input
                      ref={avatarInputRef}
                      id="chatbot-avatar"
                      type="file"
                      accept={avatarMimeTypes.join(",")}
                      onChange={(event) => void handleAvatarChange(event)}
                      className="sr-only"
                    />

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={isUploadingAvatar}
                        onClick={() => avatarInputRef.current?.click()}
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-[#111111] px-4 text-sm font-semibold text-white transition hover:bg-[#171717] disabled:opacity-60"
                      >
                        {isUploadingAvatar ? "Uploading..." : avatarUrl ? "Replace" : "Upload"}
                      </button>
                      {avatarUrl ? (
                        <button
                          type="button"
                          disabled={isUploadingAvatar}
                          onClick={() => {
                            setAvatarUrl(null);
                            setAvatarError("");
                          }}
                          className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-[#111111] px-4 text-sm font-medium text-slate-300 transition hover:border-red-400/40 hover:text-red-200 disabled:opacity-60"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {avatarError ? (
                    <p className="mt-2 text-sm text-red-300">{avatarError}</p>
                  ) : null}
                  <p className="mt-2 text-sm text-slate-400">
                    PNG, JPG, GIF or WebP, up to 1 MB. Shown in the widget
                    header; the first letter of the name is used when empty.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="chatbot-primary-color"
                    className="mb-2 block text-sm font-medium text-white"
                  >
                    Primary Color
                  </label>
                  <div className="flex items-center gap-3">
                    <span
                      className="h-11 w-11 rounded-xl border border-white/10"
                      style={{
                        backgroundColor: isPrimaryColorValid
                          ? primaryColor
                          : chatbot.primaryColor,
                      }}
                    />
                    <input
                      id="chatbot-primary-color"
                      type="text"
                      value={primaryColor}
                      onChange={(event) => setPrimaryColor(event.target.value)}
                      placeholder="#3b82f6"
                      aria-invalid={isPrimaryColorValid ? undefined : true}
                      className={`h-12 flex-1 rounded-xl border bg-[#111111] px-4 text-sm text-white outline-none transition focus:border-white ${
                        isPrimaryColorValid ? "border-white/10" : "border-red-500/60"
                      }`}
                    />
                  </div>
                  {isPrimaryColorValid ? null : (
                    <p className="mt-2 text-sm text-red-300">
                      Use a 6-digit hex color like #3b82f6, or pick one of the
                      swatches below.
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-3">
                    {chatbotColorOptions.map((color) => {
                      const isSelected = primaryColor === color;

                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setPrimaryColor(color)}
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
                    htmlFor="chatbot-widget-position"
                    className="mb-2 block text-sm font-medium text-white"
                  >
                    Widget Position
                  </label>
                  <select
                    id="chatbot-widget-position"
                    value={widgetPosition}
                    onChange={(event) =>
                      setWidgetPosition(
                        event.target.value as "BOTTOM_RIGHT" | "BOTTOM_LEFT",
                      )
                    }
                    className="h-12 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none"
                  >
                    {widgetPositionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </AccordionSection>

            <AccordionSection
              title="Messages & Fields"
              isOpen={openSections.messages}
              onToggle={() => toggleSection("messages")}
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M6 7.5h12A1.5 1.5 0 0 1 19.5 9v6A1.5 1.5 0 0 1 18 16.5H11l-4.5 3V16.5H6A1.5 1.5 0 0 1 4.5 15V9A1.5 1.5 0 0 1 6 7.5Z" />
                </svg>
              }
            >
              <div className="space-y-5">
                <div>
                  <label
                    htmlFor="chatbot-welcome-message"
                    className="mb-2 block text-sm font-medium text-white"
                  >
                    Welcome Message
                  </label>
                  <textarea
                    id="chatbot-welcome-message"
                    value={welcomeMessage}
                    onChange={(event) => setWelcomeMessage(event.target.value)}
                    className="min-h-[132px] w-full rounded-2xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white"
                  />
                </div>

                <div>
                  <p className="mb-2 block text-sm font-medium text-white">
                    Conversation starters
                  </p>
                  <p className="mb-3 text-sm text-slate-400">
                    Up to {maxConversationStarters} suggested questions shown as
                    clickable chips before the visitor sends their first message.
                  </p>
                  <div className="space-y-3">
                    {conversationStarters.map((starter, index) => (
                      <div key={index}>
                        <label htmlFor={`chatbot-starter-${index}`} className="sr-only">
                          Conversation starter {index + 1}
                        </label>
                        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#111111] px-4 py-3 focus-within:border-white">
                          <input
                            id={`chatbot-starter-${index}`}
                            type="text"
                            value={starter}
                            maxLength={maxConversationStarterLength}
                            onChange={(event) =>
                              updateConversationStarter(index, event.target.value)
                            }
                            placeholder="e.g. What are your opening hours?"
                            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                          />
                          <span className="shrink-0 text-xs text-slate-500">
                            {starter.length}/{maxConversationStarterLength}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeConversationStarter(index)}
                            className="text-slate-500 transition hover:text-red-300"
                            aria-label={`Remove conversation starter ${index + 1}`}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-4.5 w-4.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                            >
                              <path d="M5 7h14" />
                              <path d="M9 7V5.5h6V7" />
                              <path d="M8.5 7 9 19h6l.5-12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      disabled={conversationStarters.length >= maxConversationStarters}
                      onClick={addConversationStarter}
                      className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-[#111111] px-4 text-sm font-semibold text-white transition hover:bg-[#171717] disabled:opacity-50"
                    >
                      <span className="mr-2 text-lg leading-none">+</span>
                      {conversationStarters.length >= maxConversationStarters
                        ? `Maximum of ${maxConversationStarters} starters`
                        : "Add Starter"}
                    </button>
                  </div>
                </div>

                <div>
                  <p className="mb-3 block text-sm font-medium text-white">
                    Required Fields
                  </p>
                  <div className="space-y-3">
                    <ToggleRow
                      title="Name"
                      description="Ask visitors for their name before the first message."
                      checked={requireName}
                      onChange={setRequireName}
                    />
                    <ToggleRow
                      title="Email"
                      description="Capture an email address for notifications and follow-up."
                      checked={requireEmail}
                      onChange={setRequireEmail}
                    />
                    <ToggleRow
                      title="Phone"
                      description="Ask for a phone number before the conversation begins."
                      checked={requirePhone}
                      onChange={setRequirePhone}
                    />
                  </div>
                </div>
              </div>
            </AccordionSection>

            <AccordionSection
              title="Notifications"
              isOpen={openSections.notifications}
              onToggle={() => toggleSection("notifications")}
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 4.5a4 4 0 0 1 4 4V11c0 1 .3 2 .9 2.8l.8 1.2H6.3l.8-1.2c.6-.8.9-1.8.9-2.8V8.5a4 4 0 0 1 4-4Z" />
                  <path d="M10 18a2 2 0 0 0 4 0" />
                </svg>
              }
            >
              <ToggleRow
                title="Email notifications"
                description="Get an email alert if a customer starts a new chat and no operators are currently online."
                checked={emailNotifications}
                onChange={setEmailNotifications}
              />
            </AccordionSection>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#090909]">
              <div className="border-b border-white/10 px-5 py-4">
                <p className="text-lg font-semibold text-white">Live Preview</p>
                <p className="mt-1 text-sm text-slate-400">
                  {formatWidgetPositionLabel(widgetPosition)} launcher / {selectedAgentName}
                </p>
              </div>

              <ChatbotWidgetPreview
                name={name || chatbot.name}
                primaryColor={isPrimaryColorValid ? primaryColor : chatbot.primaryColor}
                welcomeMessage={welcomeMessage || defaultChatbotWelcomeMessage}
                avatarUrl={avatarUrl}
                conversationStarters={conversationStarters}
                isActive={isActive}
                position={widgetPosition}
                emailNotifications={emailNotifications}
              />
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#090909] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-white">Embed</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Widget ID: {chatbot.widgetId}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/widget/${chatbot.widgetId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl border border-white/10 bg-[#111111] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#171717]"
                  >
                    Test widget
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleCopySnippet()}
                    className="rounded-xl border border-white/10 bg-[#111111] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#171717]"
                  >
                    Copy Code
                  </button>
                </div>
              </div>

              <p className="mt-4 text-sm text-slate-400">
                Paste this before &lt;/body&gt; on every page where the chat
                should appear. The page&apos;s domain must be in Allowed Domains.
              </p>

              <pre className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-[#111111] px-4 py-4 text-xs leading-6 text-slate-300">
                <code>{embedSnippet}</code>
              </pre>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#090909] p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-lg font-semibold text-white">Danger Zone</p>
                {isActive ? null : (
                  <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200">
                    Paused
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-400">
                Pausing hides the widget on your site immediately. Deleting
                removes it from your workspace and disconnects its embed
                snippet.
              </p>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={isTogglingActive}
                  onClick={() => void handleToggleActive()}
                  className="rounded-xl border border-white/10 bg-[#111111] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#171717] disabled:opacity-60"
                >
                  {isTogglingActive
                    ? isActive
                      ? "Pausing..."
                      : "Reactivating..."
                    : isActive
                      ? "Pause Widget"
                      : "Reactivate Widget"}
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => void handleDelete()}
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-200 transition hover:bg-red-500/20 disabled:opacity-60"
                >
                  {isDeleting ? "Deleting..." : "Delete Chatbot"}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
