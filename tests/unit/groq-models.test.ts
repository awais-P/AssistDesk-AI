import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_MANAGED_MODEL,
  DEFAULT_MANAGED_MODEL,
  VOICE_MAX_TOKENS,
  agentModelCatalog,
  currentModel,
  getManagedFallbackModels,
  providerRequestOptions,
} from "@/src/lib/agent-config";
import { buildPrompt, generateAgentReply, generateCompletion } from "@/src/lib/llm-runtime";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("UT-68 Groq's current models (Llama retired, Nov 2026)", () => {
  it("UT-68.01 agents saved with a retired Llama model move to Qwen 3.8, the fastest Groq model", () => {
    expect(DEFAULT_MANAGED_MODEL).toBe("groq/qwen/qwen3.8-27b");
    expect(currentModel("groq/llama-3.3-70b-versatile")).toBe("groq/qwen/qwen3.8-27b");
    expect(currentModel("llama-3.1-8b-instant")).toBe("qwen/qwen3.8-27b");
    expect(currentModel("google/gemini-2.5-flash")).toBe("google/gemini-2.5-flash");
    expect(getManagedFallbackModels("groq/llama-3.3-70b-versatile")[0]).toBe("groq/qwen/qwen3.8-27b");
    expect(agentModelCatalog.some((entry) => entry.value.includes("llama"))).toBe(false);
  });

  it("UT-68.02 Groq's reasoning models are asked to answer at once (no long thinking first)", () => {
    expect(providerRequestOptions("Groq", "qwen/qwen3.8-27b")).toEqual({ reasoning_effort: "none" });
    expect(providerRequestOptions("Groq", "openai/gpt-oss-120b")).toEqual({ reasoning_effort: "low" });
    expect(providerRequestOptions("OpenRouter", "qwen/qwen3.8-27b")).toEqual({});
    expect(providerRequestOptions("Groq", "something-else")).toEqual({});
  });

  it("UT-68.03 a streamed Groq reply is requested with thinking off", async () => {
    vi.stubEnv("ASSISTDESK_DEFAULT_GROQ_API_KEY", "fake-groq-key-for-tests");
    vi.stubEnv("ASSISTDESK_DEFAULT_OPENROUTER_API_KEY", "");
    vi.stubEnv("ASSISTDESK_DEFAULT_GOOGLE_API_KEY", "");
    const encoder = new TextEncoder();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "Thirty days, no questions asked." } }] })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    );

    const result = await generateAgentReply({
      agent: { provider: "Default", model: "groq/llama-3.3-70b-versatile", apiKey: null, systemPrompt: null, confidenceThreshold: 0.5 },
      question: "Return window?",
      sources: [],
      stream: { onToken: () => undefined, onReset: () => undefined },
    });

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "qwen/qwen3.8-27b", stream: true, reasoning_effort: "none" });
    expect(result).toMatchObject({ reply: "Thirty days, no questions asked.", modelUsed: "groq/qwen/qwen3.8-27b" });
  });

  it("UT-68.04 calls reserve few tokens (Groq counts max_tokens per minute); background jobs use another model", async () => {
    const agent = { provider: "Default", model: DEFAULT_MANAGED_MODEL, apiKey: null, systemPrompt: null, confidenceThreshold: 0.5, maxTokens: 1024 };
    const call = await buildPrompt({ agent, question: "hello", sources: [], history: [], channel: "VOICE" });
    const chat = await buildPrompt({ agent, question: "hello", sources: [], history: [], channel: "WEB_WIDGET" });
    expect(call.prompt.maxTokens).toBe(VOICE_MAX_TOKENS);
    expect(chat.prompt.maxTokens).toBe(1024);

    vi.stubEnv("ASSISTDESK_DEFAULT_GROQ_API_KEY", "fake-groq-key-for-tests");
    vi.stubEnv("ASSISTDESK_DEFAULT_OPENROUTER_API_KEY", "");
    vi.stubEnv("ASSISTDESK_DEFAULT_GOOGLE_API_KEY", "");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "Summary." } }] }));
    expect(await generateCompletion({ system: "Summarise.", prompt: "A chat." })).toBe("Summary.");
    expect(BACKGROUND_MANAGED_MODEL).toBe("groq/openai/gpt-oss-20b");
    expect(JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body)).model).toBe("openai/gpt-oss-20b");
  });
});
