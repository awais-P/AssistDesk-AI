import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, type AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { getManagedFallbackModels } from "../agent-config";
import { type AgentRuntimeConfig, getAppUrl, hasManagedProviderKey, resolveManagedModel } from "../llm-runtime";
import { decryptSecret } from "../secrets";
import { withoutGoneModels } from "../model-health";
import { STREAM_TOTAL_TIMEOUT_MS } from "../llm-stream";

/**
 * Gives a streaming call `firstTokenMs` to produce its first piece of text (the model
 * otherwise has the full stream limit), so a stuck provider is abandoned quickly and
 * the next model in the chain is tried.
 */
async function withFirstTokenTimeout<T>(
  firstTokenMs: number,
  run: (signal: AbortSignal, receivedFirstToken: () => void) => Promise<T>,
) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(Object.assign(new Error("The AI provider took too long to respond."), { name: "TimeoutError" })),
    firstTokenMs,
  );

  try {
    return await run(controller.signal, () => clearTimeout(timer));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Module 2: tool-calling chat models for the LangGraph engine. Every provider
 * AssistDesk supports offers an OpenAI-compatible endpoint, so one LangChain
 * ChatOpenAI client covers OpenRouter, Groq, OpenAI, Google Gemini and Anthropic.
 * The agent's own model is tried first, then the managed fallback chain.
 */

export type ModelToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type ToolCallingModel = {
  /** e.g. "groq/llama-3.3-70b-versatile" or "OpenAI/gpt-4.1-mini", for logs. */
  id: string;
  invoke: (
    messages: BaseMessage[],
    options: {
      tools: ModelToolSpec[];
      forcedTool?: string | null;
      timeoutMs: number;
      /** Streams the text the model writes in this step, piece by piece. */
      onToken?: (text: string) => void;
    },
  ) => Promise<AIMessage>;
};

function chunkText(chunk: AIMessageChunk) {
  const content = chunk.content;

  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => (typeof part === "string" ? part : "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("");
}

/** Streams a model call, sends its text on as it arrives, and returns the whole message. */
async function streamToMessage(
  runnable: { stream: (messages: BaseMessage[]) => Promise<AsyncIterable<AIMessageChunk>> },
  messages: BaseMessage[],
  onToken: (text: string) => void,
  onProgress: () => void,
) {
  let full: AIMessageChunk | null = null;

  for await (const chunk of await runnable.stream(messages)) {
    full = full ? full.concat(chunk) : chunk;

    if (chunk.tool_call_chunks?.length) {
      onProgress();
    }

    const text = chunkText(chunk);

    if (text) {
      onToken(text);
    }
  }

  if (!full) {
    return new AIMessage({ content: "" });
  }

  // The graph works with whole messages: tool calls are complete only after the last chunk.
  return new AIMessage({
    id: full.id,
    content: full.content,
    tool_calls: full.tool_calls ?? [],
    usage_metadata: full.usage_metadata,
    response_metadata: full.response_metadata,
  });
}

const ENDPOINTS: Record<string, { baseURL?: string; headers?: () => Record<string, string> }> = {
  OpenRouter: { baseURL: "https://openrouter.ai/api/v1", headers: () => ({ "HTTP-Referer": getAppUrl(), "X-Title": "AssistDesk" }) },
  Groq: { baseURL: "https://api.groq.com/openai/v1" },
  OpenAI: {},
  Google: { baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  Anthropic: { baseURL: "https://api.anthropic.com/v1/" },
};

function createModel(provider: string, model: string, apiKey: string, agent: AgentRuntimeConfig, id: string): ToolCallingModel {
  const endpoint = ENDPOINTS[provider] ?? ENDPOINTS.OpenRouter;

  return {
    id,
    async invoke(messages, { tools, forcedTool, timeoutMs, onToken }) {
      const client = new ChatOpenAI({
        model,
        apiKey,
        temperature: Math.min(1, Math.max(0, agent.temperature ?? 0.3)),
        maxTokens: Math.min(2048, Math.max(256, agent.maxTokens ?? 512)),
        maxRetries: 0,
        // Streaming: the timeout covers the whole reply, so it gets the longer stream limit.
        timeout: onToken ? Math.max(timeoutMs, STREAM_TOTAL_TIMEOUT_MS) : timeoutMs,
        streamUsage: true,
        configuration: { baseURL: endpoint.baseURL, defaultHeaders: endpoint.headers?.() },
      });

      const runnable =
        tools.length === 0
          ? client
          : client.bindTools(
              tools.map((tool) => ({ type: "function" as const, function: tool })),
              forcedTool ? { tool_choice: { type: "function", function: { name: forcedTool } } } : undefined,
            );

      if (onToken) {
        // Tool-call chunks count as progress too: a model that is calling a tool is working.
        return withFirstTokenTimeout(timeoutMs, (signal, receivedFirstToken) =>
          streamToMessage(
            { stream: (input) => runnable.stream(input, { signal }) },
            messages,
            (text) => {
              receivedFirstToken();
              onToken(text);
            },
            receivedFirstToken,
          ),
        );
      }

      return runnable.invoke(messages);
    },
  };
}

/** Candidates in the order they should be tried. */
export function buildModelChain(agent: AgentRuntimeConfig): ToolCallingModel[] {
  const chain: ToolCallingModel[] = [];

  if (agent.provider !== "Default") {
    const apiKey = decryptSecret(agent.apiKey);

    if (apiKey) {
      chain.push(createModel(agent.provider, agent.model, apiKey, agent, `${agent.provider}/${agent.model}`));
    }
  }

  if (agent.provider === "Default" || hasManagedProviderKey()) {
    const start = agent.provider === "Default" ? agent.model : getManagedFallbackModels("groq/llama-3.3-70b-versatile")[0];

    for (const candidate of withoutGoneModels(getManagedFallbackModels(start), (model) => model)) {
      const resolved = resolveManagedModel(candidate);

      if (resolved.apiKey) {
        chain.push(createModel(resolved.provider, resolved.model, resolved.apiKey, agent, candidate));
      }
    }
  }

  return chain;
}

/** Text of a model message (string or content blocks). */
export function messageText(message: BaseMessage) {
  const content = message.content;

  if (typeof content === "string") {
    return content.trim();
  }

  return content
    .map((part) => (typeof part === "string" ? part : "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}
