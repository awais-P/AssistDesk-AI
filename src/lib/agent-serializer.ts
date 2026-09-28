import { maskSecret } from "./secrets";

type SerializableAgent = {
  id: string;
  name: string;
  provider: string;
  model: string;
  apiKey?: string | null;
  systemPrompt: string | null;
  temperature: number;
  confidenceThreshold: number;
  maxTokens: number;
  tone: string;
  responseLength: string;
  status: string;
  inboxId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Client-safe agent shape: the provider key is replaced by a masked preview so it
 * never reaches the browser.
 */
export function serializeAgent(agent: SerializableAgent) {
  return {
    id: agent.id,
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    hasApiKey: Boolean(agent.apiKey),
    apiKeyPreview: maskSecret(agent.apiKey),
    systemPrompt: agent.systemPrompt,
    temperature: agent.temperature,
    confidenceThreshold: agent.confidenceThreshold,
    maxTokens: agent.maxTokens,
    tone: agent.tone,
    responseLength: agent.responseLength,
    status: agent.status,
    inboxId: agent.inboxId,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

export type SerializedAgent = ReturnType<typeof serializeAgent>;
