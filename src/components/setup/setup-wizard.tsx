"use client";

import { useMemo, useState } from "react";
import {
  defaultAgentSystemPrompt,
  agentModelOptions,
} from "@/src/lib/agent-config";
import type { WorkspaceSetupState } from "@/src/lib/setup";
import { defaultChatbotWelcomeMessage } from "@/src/lib/chatbot-config";

type SetupWizardProps = {
  user: {
    fullName: string;
    email: string;
  };
  initialState: WorkspaceSetupState;
};

const widgetColors = [
  "#4f8cff",
  "#22c55e",
  "#8b5cf6",
  "#f97316",
  "#ec4899",
  "#2dd4bf",
];

const steps = [
  { title: "Inbox", caption: "Set up email" },
  { title: "AI Agent", caption: "Train your agent" },
  { title: "Knowledge Base", caption: "Add your content" },
  { title: "Chatbot", caption: "Widget config" },
];

function getStartingStep(state: WorkspaceSetupState) {
  if (state.inboxes.length === 0) {
    return 0;
  }

  if (state.agents.length === 0) {
    return 1;
  }

  if (state.knowledgeSources.length === 0) {
    return 2;
  }

  if (state.chatbots.length === 0) {
    return 3;
  }

  return 3;
}

function buildAgentPrompt(name: string) {
  return defaultAgentSystemPrompt.replace(
    "You are a helpful AI assistant specialized in answering questions and customer support using retrieved documents.",
    `You are ${name}. You are a helpful AI assistant specialized in answering questions and customer support using retrieved documents.`,
  );
}

function createKnowledgeTitleFromUrl(url: string) {
  const cleaned = url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];

  return cleaned ? `${cleaned} website content` : "Website knowledge";
}

function StepProgress({
  currentStep,
}: {
  currentStep: number;
}) {
  return (
    <div className="mx-auto mt-6 flex w-full max-w-[860px] items-start justify-center">
      {steps.map((step, index) => {
        const isComplete = index < currentStep;
        const isCurrent = index === currentStep;

        return (
          <div
            key={step.title}
            className="flex min-w-0 flex-1 items-start justify-center"
          >
            <div className="flex w-full items-start justify-center">
              <div className="flex w-full max-w-[180px] flex-col items-center">
                <div className="flex w-full items-center">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-all duration-300 ${
                      isCurrent
                        ? "border-white bg-white text-[#050505] shadow-[0_0_0_5px_rgba(255,255,255,0.06)]"
                        : isComplete
                          ? "border-white/70 bg-[#161616] text-white"
                        : "border-white/10 bg-[#111111] text-slate-400"
                    }`}
                  >
                    {isComplete ? (
                      <svg
                        viewBox="0 0 16 16"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3.5 8.5 6.5 11.5 12.5 5.5" />
                      </svg>
                    ) : (
                      index + 1
                    )}
                  </div>

                  {index < steps.length - 1 ? (
                    <div className="ml-2 h-px flex-1 bg-white/10">
                      <div
                        className={`h-px transition-all duration-300 ${
                          index < currentStep ? "w-full bg-white" : "w-0 bg-white"
                        }`}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="mt-2.5 text-center">
                  <p
                    className={`text-sm font-semibold transition-colors duration-300 ${
                      isCurrent || isComplete ? "text-white" : "text-slate-500"
                    }`}
                  >
                    {step.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{step.caption}</p>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SetupWizard({ user, initialState }: SetupWizardProps) {
  const initialInbox = initialState.inboxes[0];
  const initialAgent = initialState.agents[0];
  const initialChatbot = initialState.chatbots[0];
  const existingUrlSources = initialState.knowledgeSources.filter(
    (item) => item.type === "URL",
  );
  const existingTextSource = initialState.knowledgeSources.find(
    (item) => item.type === "TEXT",
  );

  const [currentStep, setCurrentStep] = useState(getStartingStep(initialState));
  const [inboxId, setInboxId] = useState(initialInbox?.id ?? "");
  const [inboxName, setInboxName] = useState(initialInbox?.name ?? "Support");
  const [emailPrefix, setEmailPrefix] = useState(
    initialInbox?.emailPrefix ?? user.fullName.toLowerCase().split(" ")[0],
  );
  const [senderEmail, setSenderEmail] = useState(
    initialInbox?.senderEmail ?? user.email,
  );
  const [prefixStatus, setPrefixStatus] = useState("");
  const [agentId, setAgentId] = useState(initialAgent?.id ?? "");
  const [agentName, setAgentName] = useState(
    initialAgent?.name ?? "Support Assistant",
  );
  const [systemPrompt, setSystemPrompt] = useState(
    initialAgent?.systemPrompt ?? buildAgentPrompt("Support Assistant"),
  );
  const [knowledgeMode, setKnowledgeMode] = useState<"URL" | "TEXT">(
    existingUrlSources.length > 0 ? "URL" : "TEXT",
  );
  const [urlInput, setUrlInput] = useState("");
  const [urlEntries, setUrlEntries] = useState<string[]>([]);
  const [knowledgeText, setKnowledgeText] = useState(
    existingTextSource?.rawText ?? "",
  );
  const [savedKnowledgeCountState, setSavedKnowledgeCountState] = useState(
    initialState.knowledgeSources.length,
  );
  const [chatbotId, setChatbotId] = useState(initialChatbot?.id ?? "");
  const [chatbotName, setChatbotName] = useState(
    initialChatbot?.name ?? "Website Support Bot",
  );
  const [domainInput, setDomainInput] = useState("");
  const [allowedDomains, setAllowedDomains] = useState<string[]>(
    initialChatbot?.allowedDomains ?? ["localhost"],
  );
  const [primaryColor, setPrimaryColor] = useState(
    initialChatbot?.primaryColor ?? "#4f8cff",
  );
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const savedKnowledgeCount = useMemo(() => {
    return savedKnowledgeCountState + urlEntries.length;
  }, [savedKnowledgeCountState, urlEntries.length]);

  async function handleLogout() {
    await fetch("/api/auth/logout", {
      method: "POST",
    });

    window.location.assign("/login");
  }

  async function checkInboxAvailability() {
    setError("");
    setFeedback("");
    setPrefixStatus("");

    const response = await fetch(
      `/api/inboxes?emailPrefix=${encodeURIComponent(emailPrefix)}`,
    );
    const data = (await response.json()) as {
      isAvailable?: boolean;
      message?: string;
    };

    setPrefixStatus(data.message ?? "Unable to verify right now.");
  }

  async function handleInboxContinue() {
    setError("");
    setFeedback("");
    setIsSaving(true);

    try {
      const response = await fetch("/api/inboxes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: inboxId || undefined,
          name: inboxName,
          emailPrefix,
          senderEmail,
          autoReplyEnabled: true,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        inbox?: { id: string; name: string; emailPrefix: string };
      };

      if (!response.ok || !data.inbox) {
        setError(data.error ?? "Unable to save inbox right now.");
        setIsSaving(false);
        return;
      }

      setInboxId(data.inbox.id);
      setInboxName(data.inbox.name);
      setEmailPrefix(data.inbox.emailPrefix);
      setFeedback("Inbox saved successfully.");
      setCurrentStep(1);
    } catch {
      setError("Something went wrong while saving your inbox.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAgentContinue() {
    setError("");
    setFeedback("");
    setIsSaving(true);

    try {
      const response = await fetch("/api/ai-agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: agentId || undefined,
          name: agentName,
          inboxId: inboxId || null,
          provider: "Default",
          model: agentModelOptions[0],
          systemPrompt,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        agent?: { id: string; name: string; systemPrompt: string | null };
      };

      if (!response.ok || !data.agent) {
        setError(data.error ?? "Unable to save AI agent right now.");
        setIsSaving(false);
        return;
      }

      setAgentId(data.agent.id);
      setAgentName(data.agent.name);
      setSystemPrompt(
        data.agent.systemPrompt ?? buildAgentPrompt(data.agent.name),
      );
      setFeedback("AI agent saved successfully.");
      setCurrentStep(2);
    } catch {
      setError("Something went wrong while saving your AI agent.");
    } finally {
      setIsSaving(false);
    }
  }

  function addUrlEntry() {
    const cleaned = urlInput.trim();

    if (!cleaned) {
      return;
    }

    if (urlEntries.includes(cleaned)) {
      setUrlInput("");
      return;
    }

    setUrlEntries((current) => [...current, cleaned]);
    setUrlInput("");
  }

  function addDomainEntry() {
    const cleaned = domainInput.trim();

    if (!cleaned) {
      return;
    }

    if (allowedDomains.includes(cleaned)) {
      setDomainInput("");
      return;
    }

    setAllowedDomains((current) => [...current, cleaned]);
    setDomainInput("");
  }

  async function handleKnowledgeContinue(skip: boolean) {
    setError("");
    setFeedback("");

    if (skip) {
      setCurrentStep(3);
      return;
    }

    setIsSaving(true);

    try {
      if (knowledgeMode === "URL") {
        const urlsToSave =
          urlEntries.length > 0
            ? urlEntries
            : urlInput.trim()
              ? [urlInput.trim()]
              : [];

        if (urlsToSave.length === 0) {
          setCurrentStep(3);
          setIsSaving(false);
          return;
        }

        for (const url of urlsToSave) {
          const response = await fetch("/api/knowledge-sources", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              agentId: agentId || null,
              title: createKnowledgeTitleFromUrl(url),
              type: "URL",
              sourceUrl: url,
            }),
          });

          const data = (await response.json()) as { error?: string };

          if (!response.ok) {
            setError(data.error ?? "Unable to save one of the website sources.");
            setIsSaving(false);
            return;
          }
        }

        setSavedKnowledgeCountState((count) => count + urlsToSave.length);
        setUrlEntries([]);
        setUrlInput("");
      } else if (knowledgeText.trim()) {
        const shouldCreateText =
          existingTextSource?.rawText?.trim() !== knowledgeText.trim();

        if (shouldCreateText) {
          const response = await fetch("/api/knowledge-sources", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              agentId: agentId || null,
              title: `${agentName} manual knowledge`,
              type: "TEXT",
              rawText: knowledgeText.trim(),
            }),
          });

          const data = (await response.json()) as { error?: string };

          if (!response.ok) {
            setError(data.error ?? "Unable to save manual knowledge.");
            setIsSaving(false);
            return;
          }

          setSavedKnowledgeCountState((count) => count + 1);
        }
      }

      setFeedback("Knowledge step saved.");
      setCurrentStep(3);
    } catch {
      setError("Something went wrong while saving knowledge sources.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleChatbotComplete() {
    setError("");
    setFeedback("");
    setIsSaving(true);

    try {
      const response = await fetch("/api/chatbots", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: chatbotId || undefined,
          name: chatbotName,
          agentId,
          allowedDomains,
          primaryColor,
          welcomeMessage: defaultChatbotWelcomeMessage,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        chatbot?: { id: string };
      };

      if (!response.ok || !data.chatbot) {
        setError(data.error ?? "Unable to create chatbot widget right now.");
        setIsSaving(false);
        return;
      }

      setChatbotId(data.chatbot.id);
      window.location.assign("/dashboard/tickets");
    } catch {
      setError("Something went wrong while creating your chatbot widget.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-black px-4 py-4 text-white md:px-5 lg:flex lg:items-center lg:py-3">
      <div className="mx-auto w-full max-w-[940px]">
        <div className="text-center">
          <h1 className="heading-font text-[2.2rem] font-bold text-white md:text-[3rem]">
            Welcome to AssistDesk AI
          </h1>
          <p className="mt-2 text-sm text-slate-400 md:text-base">
            Let&apos;s get your customer support agent set up in minutes
          </p>
        </div>

        <StepProgress currentStep={currentStep} />

        <div className="mx-auto mt-5 max-w-[860px] rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Step {currentStep + 1} of {steps.length}
              </p>
              <h2 className="heading-font mt-2 text-[1.9rem] font-semibold text-white md:text-[2.2rem]">
                {currentStep === 0
                  ? "Create Your Inbox"
                  : currentStep === 1
                    ? "Create AI Agent"
                    : currentStep === 2
                      ? "Add Knowledge Base"
                      : "Create Chatbot Widget"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                {currentStep === 0
                  ? "Set up your support inbox for AI to handle tickets via email."
                  : currentStep === 1
                    ? "Create the assistant identity and connect it with your inbox."
                    : currentStep === 2
                      ? "Train your AI with website content or manual knowledge."
                      : "Configure your website widget and finish the setup flow."}
              </p>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="shrink-0 rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-[#1a1a1a]"
            >
              Logout
            </button>
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-[#0b0b0b] p-4 md:p-5">
            {currentStep === 0 ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Inbox Name
                  </label>
                  <input
                    type="text"
                    value={inboxName}
                    onChange={(event) => setInboxName(event.target.value)}
                    placeholder="Support, Sales, General"
                    className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Email Address
                  </label>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                    <input
                      type="text"
                      value={emailPrefix}
                      onChange={(event) => setEmailPrefix(event.target.value)}
                      placeholder="company"
                      className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                    />
                    <div className="inline-flex items-center rounded-xl border border-white/10 bg-[#141414] px-4 text-sm text-slate-400">
                      @assistdesk.ai
                    </div>
                    <button
                      type="button"
                      onClick={checkInboxAvailability}
                      className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#161616] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1d1d1d]"
                    >
                      Check
                    </button>
                  </div>
                  {prefixStatus ? (
                    <p className="mt-2 text-xs text-slate-400">{prefixStatus}</p>
                  ) : null}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Sender Email
                  </label>
                  <input
                    type="email"
                    value={senderEmail}
                    onChange={(event) => setSenderEmail(event.target.value)}
                    placeholder="support@yourcompany.com"
                    className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                  />
                </div>
              </div>
            ) : null}

            {currentStep === 1 ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Agent Name
                  </label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(event) => {
                      const nextName = event.target.value;
                      setAgentName(nextName);
                      setSystemPrompt(buildAgentPrompt(nextName || "Support Assistant"));
                    }}
                    placeholder="Support Assistant"
                    className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                  />
                </div>

                <div className="rounded-xl border border-white/10 bg-[#111111] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Connected Inbox
                  </p>
                  <p className="mt-2 text-sm text-white">
                    {inboxName} @{emailPrefix}.assistdesk.ai
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    System Prompt
                  </label>
                  <textarea
                    value={systemPrompt}
                    onChange={(event) => setSystemPrompt(event.target.value)}
                    className="min-h-[120px] w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white"
                  />
                </div>
              </div>
            ) : null}

            {currentStep === 2 ? (
              <div className="space-y-4">
                <div className="inline-flex rounded-xl border border-white/10 bg-[#141414] p-1">
                  {(["URL", "TEXT"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setKnowledgeMode(mode)}
                      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                        knowledgeMode === mode
                          ? "bg-white text-[#050505]"
                          : "text-slate-400 hover:bg-white/5"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>

                {knowledgeMode === "URL" ? (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-300">
                      Add Website URLs
                    </label>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                      <input
                        type="text"
                        value={urlInput}
                        onChange={(event) => setUrlInput(event.target.value)}
                        placeholder="https://example.com/docs"
                        className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                      />
                      <button
                        type="button"
                        onClick={addUrlEntry}
                        className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#161616] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1d1d1d]"
                      >
                        Add
                      </button>
                    </div>

                    {urlEntries.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {urlEntries.map((url) => (
                          <span
                            key={url}
                            className="rounded-full border border-white/10 bg-[#151515] px-3 py-1 text-xs text-slate-300"
                          >
                            {url}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-300">
                      Manual Knowledge Text
                    </label>
                    <textarea
                      value={knowledgeText}
                      onChange={(event) => setKnowledgeText(event.target.value)}
                      placeholder="Paste your FAQs, policies, pricing details, or product notes..."
                      className="min-h-[130px] w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white"
                    />
                  </div>
                )}

                <div className="rounded-xl border border-white/10 bg-[#111111] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Saved Knowledge Items
                  </p>
                  <p className="mt-2 text-sm text-white">
                    {savedKnowledgeCount} source
                    {savedKnowledgeCount === 1 ? "" : "s"} prepared for this
                    workspace
                  </p>
                </div>
              </div>
            ) : null}

            {currentStep === 3 ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Chatbot Name
                  </label>
                  <input
                    type="text"
                    value={chatbotName}
                    onChange={(event) => setChatbotName(event.target.value)}
                    placeholder="Website Support Bot"
                    className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Allowed Domains
                  </label>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                    <input
                      type="text"
                      value={domainInput}
                      onChange={(event) => setDomainInput(event.target.value)}
                      placeholder="https://example.com"
                      className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                    />
                    <button
                      type="button"
                      onClick={addDomainEntry}
                      className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#161616] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1d1d1d]"
                    >
                      Add
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {allowedDomains.map((domain) => (
                      <span
                        key={domain}
                        className="rounded-full border border-white/10 bg-[#151515] px-3 py-1 text-xs text-slate-300"
                      >
                        {domain}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-3 block text-sm font-medium text-slate-300">
                    Widget Color
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {widgetColors.map((color) => {
                      const isSelected = primaryColor === color;

                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setPrimaryColor(color)}
                          className={`flex h-11 w-11 items-center justify-center rounded-full border-2 text-xs font-semibold transition ${
                            isSelected
                              ? "border-white"
                              : "border-transparent"
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
              </div>
            ) : null}
          </div>

          {error ? (
            <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          ) : null}

          {feedback ? (
            <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {feedback}
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2.5">
              {currentStep > 0 ? (
                <button
                  type="button"
                  onClick={() => setCurrentStep((value) => Math.max(0, value - 1))}
                  className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#191919]"
                >
                  Back
                </button>
              ) : null}

              {currentStep === 2 ? (
                <button
                  type="button"
                  onClick={() => handleKnowledgeContinue(true)}
                  className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm font-semibold text-slate-300 transition hover:bg-[#191919]"
                >
                  Skip for now
                </button>
              ) : null}
            </div>

            {currentStep === 0 ? (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleInboxContinue}
                className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
              >
                {isSaving ? "Saving..." : "Continue"}
              </button>
            ) : null}

            {currentStep === 1 ? (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleAgentContinue}
                className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
              >
                {isSaving ? "Saving..." : "Continue"}
              </button>
            ) : null}

            {currentStep === 2 ? (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => handleKnowledgeContinue(false)}
                className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
              >
                {isSaving ? "Saving..." : "Continue"}
              </button>
            ) : null}

            {currentStep === 3 ? (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleChatbotComplete}
                className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
              >
                {isSaving ? "Finishing..." : "Complete Setup"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
