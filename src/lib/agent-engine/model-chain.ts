import { ChatOpenAI } from "@langchain/openai";
import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import { getManagedFallbackModels } from "../agent-config";
import { type AgentRuntimeConfig, getAppUrl, hasManagedProviderKey, resolveManagedModel } from "../llm-runtime";
import { decryptSecret } from "../secrets";
import { withoutGoneModels } from "../model-health";

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
    options: { tools: ModelToolSpec[]; forcedTool?: string | null; timeoutMs: number },
  ) => Promise<AIMessage>;
};

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
    async invoke(messages, { tools, forcedTool, timeoutMs }) {
      const client = new ChatOpenAI({
        model,
        apiKey,
        temperature: Math.min(1, Math.max(0, agent.temperature ?? 0.3)),
        maxTokens: Math.min(2048, Math.max(256, agent.maxTokens ?? 512)),
        maxRetries: 0,
        timeout: timeoutMs,
        configuration: { baseURL: endpoint.baseURL, defaultHeaders: endpoint.headers?.() },
      });

      if (tools.length === 0) {
        return client.invoke(messages);
      }

      const bound = client.bindTools(
        tools.map((tool) => ({ type: "function" as const, function: tool })),
        forcedTool ? { tool_choice: { type: "function", function: { name: forcedTool } } } : undefined,
      );
      return bound.invoke(messages);
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
