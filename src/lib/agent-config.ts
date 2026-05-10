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
    label: "Default",
    description: "Managed AssistDesk models using your server-side keys.",
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
    value: "groq/llama-3.1-8b-instant",
    label: "Managed Llama 3.1 8B Instant",
    provider: "Default",
    managed: true,
  },
  {
    value: "google/gemini-2.0-flash-lite",
    label: "Managed Gemini 2.0 Flash Lite",
    provider: "Default",
    managed: true,
  },
  {
    value: "openrouter/google/gemma-3-27b-it:free",
    label: "Managed Gemma 3 27B Free",
    provider: "Default",
    managed: true,
  },
  {
    value: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    label: "Managed Llama 3.3 70B Instruct Free",
    provider: "Default",
    managed: true,
  },
  {
    value: "meta/llama-3.3-70b-instruct-fp8-fast",
    label: "Legacy Managed Llama 3.3 FP8 Fast",
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
    value: "claude-3-5-haiku-latest",
    label: "Claude 3.5 Haiku",
    provider: "Anthropic",
    managed: false,
  },
  {
    value: "claude-3-7-sonnet-latest",
    label: "Claude 3.7 Sonnet",
    provider: "Anthropic",
    managed: false,
  },
  {
    value: "gemini-2.0-flash-lite",
    label: "Gemini 2.0 Flash Lite",
    provider: "Google",
    managed: false,
  },
  {
    value: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
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
    value: "google/gemma-3-27b-it:free",
    label: "Gemma 3 27B Free",
    provider: "OpenRouter",
    managed: false,
  },
  {
    value: "meta-llama/llama-3.3-70b-instruct:free",
    label: "Llama 3.3 70B Instruct Free",
    provider: "OpenRouter",
    managed: false,
  },
  {
    value: "deepseek/deepseek-chat-v3-0324:free",
    label: "DeepSeek Chat V3 Free",
    provider: "OpenRouter",
    managed: false,
  },
] as const;

export const agentModelOptions = agentModelCatalog
  .filter((model) => model.provider === "Default")
  .map((model) => model.value);

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

export function formatAgentRuntimeLabel(model: string) {
  return model;
}

export function formatAgentShortId(id: string) {
  return id.slice(-3).toUpperCase();
}
