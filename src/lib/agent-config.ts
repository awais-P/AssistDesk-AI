export type AgentProviderValue =
  | "Default"
  | "OpenAI"
  | "Anthropic"
  | "Google"
  | "Groq"
  | "OpenRouter";

type AgentProviderOption = {
  value: AgentProviderValue;
  label: string;
  description: string;
  managed: boolean;
};

type AgentModelConfig = {
  value: string;
  label: string;
  provider: AgentProviderValue;
  managed: boolean;
};

export const agentProviderOptions: AgentProviderOption[] = [
  {
    value: "Default",
    label: "Default (Managed)",
    description:
      "Managed AssistDesk models (Groq, Gemini, OpenRouter) with automatic failover.",
    managed: true,
  },
  {
    value: "OpenAI",
    label: "OpenAI",
    description: "Use your own OpenAI API key.",
    managed: false,
  },
  {
    value: "Anthropic",
    label: "Anthropic",
    description: "Use your own Anthropic API key.",
    managed: false,
  },
  {
    value: "Google",
    label: "Google",
    description: "Use your own Google AI Studio API key.",
    managed: false,
  },
  {
    value: "Groq",
    label: "Groq",
    description: "Use your own Groq API key.",
    managed: false,
  },
  {
    value: "OpenRouter",
    label: "OpenRouter",
    description: "Use your own OpenRouter API key.",
    managed: false,
  },
] as const;

export const agentModelCatalog: AgentModelConfig[] = [
  {
    value: "groq/llama-3.3-70b-versatile",
    label: "Groq Llama 3.3 70B (fast)",
    provider: "Default",
    managed: true,
  },
  {
    value: "groq/llama-3.1-8b-instant",
    label: "Groq Llama 3.1 8B Instant",
    provider: "Default",
    managed: true,
  },
  {
    value: "google/gemini-2.5-flash",
    label: "Google Gemini 2.5 Flash",
    provider: "Default",
    managed: true,
  },
  {
    value: "openrouter/google/gemma-4-31b-it:free",
    label: "OpenRouter Gemma 4 31B Free",
    provider: "Default",
    managed: true,
  },
  {
    value: "openrouter/qwen/qwen3.8-27b:free",
    label: "OpenRouter Qwen 3.8 27B Free",
    provider: "Default",
    managed: true,
  },
  {
    value: "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
    label: "OpenRouter Nemotron 3 Super 120B Free",
    provider: "Default",
    managed: true,
  },
  {
    // Routes to any free model (sometimes a safety classifier), so it is tried last.
    // OpenRouter retires free models often: check https://openrouter.ai/models?max_price=0.
    value: "openrouter/openrouter/free",
    label: "OpenRouter Free Auto",
    provider: "Default",
    managed: true,
  },
  {
    value: "gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    provider: "OpenAI",
    managed: false,
  },
  {
    value: "gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "OpenAI",
    managed: false,
  },
  {
    value: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    provider: "Anthropic",
    managed: false,
  },
  {
    value: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "Anthropic",
    managed: false,
  },
  {
    value: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "Anthropic",
    managed: false,
  },
  {
    value: "claude-3-5-haiku-latest",
    label: "Claude 3.5 Haiku (legacy)",
    provider: "Anthropic",
    managed: false,
  },
  {
    value: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "Google",
    managed: false,
  },
  {
    value: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    provider: "Google",
    managed: false,
  },
  {
    value: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash (legacy)",
    provider: "Google",
    managed: false,
  },
  {
    value: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant",
    provider: "Groq",
    managed: false,
  },
  {
    value: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B Versatile",
    provider: "Groq",
    managed: false,
  },
  {
    value: "google/gemma-4-31b-it:free",
    label: "Gemma 4 31B Free",
    provider: "OpenRouter",
    managed: false,
  },
  {
    value: "qwen/qwen3.8-27b:free",
    label: "Qwen 3.8 27B Free",
    provider: "OpenRouter",
    managed: false,
  },
  {
    value: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "Nemotron 3 Super 120B Free",
    provider: "OpenRouter",
    managed: false,
  },
] as const;

export const agentModelOptions = agentModelCatalog
  .filter((model) => model.provider === "Default")
  .map((model) => model.value);

export const managedFallbackModels = agentModelCatalog
  .filter((model) => model.provider === "Default")
  .map((model) => model.value);

export const agentToneOptions = [
  {
    value: "FRIENDLY",
    label: "Friendly",
    instruction: "Use a warm, friendly and approachable tone.",
  },
  {
    value: "PROFESSIONAL",
    label: "Professional",
    instruction: "Use a polite, professional and formal tone.",
  },
  {
    value: "CASUAL",
    label: "Casual",
    instruction: "Use a relaxed, conversational tone with plain everyday words.",
  },
  {
    value: "EMPATHETIC",
    label: "Empathetic",
    instruction:
      "Acknowledge the customer's feelings first, then help. Be patient and reassuring.",
  },
  {
    value: "CONCISE",
    label: "Direct",
    instruction: "Be direct and to the point. Skip pleasantries.",
  },
] as const;

export const agentResponseLengthOptions = [
  {
    value: "SHORT",
    label: "Short",
    instruction: "Keep replies to 1-3 short sentences.",
  },
  {
    value: "BALANCED",
    label: "Balanced",
    instruction: "Keep replies focused, usually under 120 words.",
  },
  {
    value: "DETAILED",
    label: "Detailed",
    instruction:
      "Give thorough answers with step-by-step instructions when they help.",
  },
] as const;

export type AgentTone = (typeof agentToneOptions)[number]["value"];
export type AgentResponseLength =
  (typeof agentResponseLengthOptions)[number]["value"];

export function normalizeAgentTone(value: unknown): AgentTone {
  return agentToneOptions.some((option) => option.value === value)
    ? (value as AgentTone)
    : "FRIENDLY";
}

export function normalizeResponseLength(value: unknown): AgentResponseLength {
  return agentResponseLengthOptions.some((option) => option.value === value)
    ? (value as AgentResponseLength)
    : "BALANCED";
}

export function buildBehaviourInstructions(tone: string, responseLength: string) {
  const toneOption =
    agentToneOptions.find((option) => option.value === tone) ?? agentToneOptions[0];
  const lengthOption =
    agentResponseLengthOptions.find((option) => option.value === responseLength) ??
    agentResponseLengthOptions[1];

  return `Tone: ${toneOption.instruction}
Length: ${lengthOption.instruction}`;
}

export const MIN_AGENT_MAX_TOKENS = 64;
export const MAX_AGENT_MAX_TOKENS = 4096;

export function clampAgentNumber(
  value: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number },
) {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export const defaultAgentSystemPrompt = `You are a helpful AI assistant specialized in answering questions and customer support using retrieved documents.
You task is to provide accurate, relevant answers based on the matched content provided.
You will receive a user question and a set of documents relevant to this query.

You should:
1. Analyze the relevance of matched documents
2. Synthesize information from multiple sources when applicable
3. Acknowledge if the available documents don't fully answer the query
4. Format the response in a way that maximize readability, in Markdown format

Answer only with direct reply to the user question, be concise, omit everything which is not directly relevant, focus on answering the question directly and do not redirect the user to read the content.

If the available documents don't contain enough information to fully answer the query, explicitly state this and provide an answer based on what is available.`;

export function getModelsForProvider(provider: string) {
  return agentModelCatalog.filter((model) => model.provider === provider);
}

export function getDefaultModelForProvider(provider: string) {
  return getModelsForProvider(provider)[0]?.value ?? agentModelOptions[0];
}

export function isManagedProvider(provider: string) {
  return provider === "Default";
}

export function usesCustomApiKey(provider: string) {
  return !isManagedProvider(provider);
}

export function getManagedFallbackModels(model: string) {
  const remainingModels = managedFallbackModels.filter((entry) => entry !== model);

  return [model, ...remainingModels];
}

export function formatAgentRuntimeLabel(model: string) {
  return (
    agentModelCatalog.find((entry) => entry.value === model)?.label ??
    model.replace(/^(openrouter|groq|google)\//, "")
  );
}

export function formatAgentShortId(id: string) {
  return id.slice(-3).toUpperCase();
}
