import {
  estimateTokenUsage,
  generateGroundedAgentReply,
  type RuntimeKnowledgeSource,
} from "./knowledge-runtime";
import { getManagedFallbackModels } from "./agent-config";

type AgentRuntimeConfig = {
  provider: string;
  model: string;
  apiKey: string | null;
  systemPrompt: string | null;
  confidenceThreshold: number;
};

type AgentLlmReply = {
  reply: string;
  confidence: number;
  tokens: number;
  providerUsed: string;
  modelUsed: string;
  usedFallback: boolean;
  usedSourceIds: string[];
};

function buildMessages({
  systemPrompt,
  question,
  sources,
}: {
  systemPrompt: string;
  question: string;
  sources: RuntimeKnowledgeSource[];
}) {
  const grounded = generateGroundedAgentReply({
    question,
    confidenceThreshold: 0,
    sources,
  });

  const knowledgeBlock =
    grounded.matches.length > 0
      ? grounded.matches
          .map(
            (match, index) =>
              `Source ${index + 1}: ${match.title}\n${match.excerpt}`,
          )
          .join("\n\n")
      : "No matching knowledge sources were found.";

  return {
    systemPrompt,
    userPrompt: `Customer question:\n${question}\n\nRelevant knowledge:\n${knowledgeBlock}\n\nAnswer only using the relevant knowledge above. If the knowledge is incomplete, say so clearly.`,
    fallback: grounded,
  };
}

function getManagedApiKey(model: string) {
  if (model.startsWith("groq/")) {
    return process.env.ASSISTDESK_DEFAULT_GROQ_API_KEY || null;
  }

  if (model.startsWith("google/")) {
    return process.env.ASSISTDESK_DEFAULT_GOOGLE_API_KEY || null;
  }

  if (model.startsWith("openrouter/")) {
    return process.env.ASSISTDESK_DEFAULT_OPENROUTER_API_KEY || null;
  }

  return null;
}

function getProviderApiKey(config: AgentRuntimeConfig) {
  if (config.provider === "Default") {
    return getManagedApiKey(config.model);
  }

  return config.apiKey || null;
}

function stripManagedPrefix(model: string) {
  return model.startsWith("openrouter/")
    ? model.replace("openrouter/", "")
    : model;
}

async function callOpenAiCompatibleModel({
  endpoint,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  extraHeaders,
}: {
  endpoint: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  extraHeaders?: Record<string, string>;
}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const data = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
    usage?: {
      total_tokens?: number;
    };
  };

  if (!response.ok) {
    throw new Error(data.error?.message || "Provider request failed.");
  }

  return {
    reply: data.choices?.[0]?.message?.content?.trim() || "",
    tokens: data.usage?.total_tokens || 0,
  };
}

async function callAnthropicModel({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
}: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  const data = (await response.json()) as {
    error?: { message?: string };
    content?: Array<{ type: string; text?: string }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };

  if (!response.ok) {
    throw new Error(data.error?.message || "Anthropic request failed.");
  }

  const text =
    data.content
      ?.filter((item) => item.type === "text" && item.text)
      .map((item) => item.text)
      .join("\n")
      .trim() || "";

  return {
    reply: text,
    tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
  };
}

async function callGoogleModel({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
}: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
        },
      }),
    },
  );

  const data = (await response.json()) as {
    error?: { message?: string };
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
    usageMetadata?: {
      totalTokenCount?: number;
    };
  };

  if (!response.ok) {
    throw new Error(data.error?.message || "Google request failed.");
  }

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n")
      .trim() || "";

  return {
    reply: text,
    tokens: data.usageMetadata?.totalTokenCount || 0,
  };
}

export async function generateAgentReply({
  agent,
  question,
  sources,
}: {
  agent: AgentRuntimeConfig;
  question: string;
  sources: RuntimeKnowledgeSource[];
}): Promise<AgentLlmReply> {
  const messages = buildMessages({
    systemPrompt: agent.systemPrompt || "You are a helpful support assistant.",
    question,
    sources,
  });

  const fallbackTokens = estimateTokenUsage(question, messages.fallback.reply);
  const apiKey = getProviderApiKey(agent);
  const usedSourceIds = Array.from(
    new Set(messages.fallback.matches.map((match) => match.sourceId)),
  );

  if (!apiKey) {
    return {
      reply: messages.fallback.reply,
      confidence: messages.fallback.confidence,
      tokens: fallbackTokens,
      providerUsed: agent.provider,
      modelUsed: agent.model,
      usedFallback: true,
      usedSourceIds,
    };
  }

  try {
    let result: { reply: string; tokens: number };
    let resolvedModel = agent.model;

    if (agent.provider === "Anthropic") {
      result = await callAnthropicModel({
        apiKey,
        model: agent.model,
        systemPrompt: messages.systemPrompt,
        userPrompt: messages.userPrompt,
      });
    } else if (agent.provider === "Google") {
      result = await callGoogleModel({
        apiKey,
        model: agent.model,
        systemPrompt: messages.systemPrompt,
        userPrompt: messages.userPrompt,
      });
    } else if (agent.provider === "Groq") {
      result = await callOpenAiCompatibleModel({
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        apiKey,
        model: agent.model,
        systemPrompt: messages.systemPrompt,
        userPrompt: messages.userPrompt,
      });
    } else if (agent.provider === "OpenRouter") {
      result = await callOpenAiCompatibleModel({
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        apiKey,
        model: agent.model,
        systemPrompt: messages.systemPrompt,
        userPrompt: messages.userPrompt,
        extraHeaders: {
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "AssistDesk",
        },
      });
    } else if (agent.provider === "OpenAI") {
      result = await callOpenAiCompatibleModel({
        endpoint: "https://api.openai.com/v1/chat/completions",
        apiKey,
        model: agent.model,
        systemPrompt: messages.systemPrompt,
        userPrompt: messages.userPrompt,
      });
    } else if (agent.provider === "Default") {
      const candidateModels = getManagedFallbackModels(agent.model);
      let lastError: Error | null = null;
      let successfulResult: { reply: string; tokens: number } | null = null;

      for (const candidateModel of candidateModels) {
        try {
          successfulResult = await callOpenAiCompatibleModel({
            endpoint: "https://openrouter.ai/api/v1/chat/completions",
            apiKey,
            model: stripManagedPrefix(candidateModel),
            systemPrompt: messages.systemPrompt,
            userPrompt: messages.userPrompt,
            extraHeaders: {
              "HTTP-Referer": "http://localhost:3000",
              "X-Title": "AssistDesk",
            },
          });
          resolvedModel = candidateModel;
          break;
        } catch (error) {
          lastError =
            error instanceof Error
              ? error
              : new Error("Managed OpenRouter request failed.");
        }
      }

      if (!successfulResult) {
        throw lastError || new Error("No managed OpenRouter model was available.");
      }

      result = successfulResult;
    } else {
      result = await callOpenAiCompatibleModel({
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        apiKey,
        model: agent.model,
        systemPrompt: messages.systemPrompt,
        userPrompt: messages.userPrompt,
        extraHeaders: {
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "AssistDesk",
        },
      });
    }

    return {
      reply: result.reply || messages.fallback.reply,
      confidence: messages.fallback.confidence,
      tokens: result.tokens || fallbackTokens,
      providerUsed: agent.provider,
      modelUsed: resolvedModel,
      usedFallback: !result.reply,
      usedSourceIds,
    };
  } catch {
    return {
      reply: messages.fallback.reply,
      confidence: messages.fallback.confidence,
      tokens: fallbackTokens,
      providerUsed: agent.provider,
      modelUsed: agent.model,
      usedFallback: true,
      usedSourceIds,
    };
  }
}
