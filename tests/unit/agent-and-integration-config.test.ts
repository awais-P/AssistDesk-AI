import { describe, expect, it } from "vitest";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  buildBehaviourInstructions,
  clampAgentNumber,
  getManagedFallbackModels,
  normalizeAgentTone,
  normalizeResponseLength,
} from "@/src/lib/agent-config";
import { isUnusableReply } from "@/src/lib/llm-runtime";
import {
  maskIntegrationConfig,
  mergeIntegrationConfig,
  readIntegrationConfig,
} from "@/src/lib/integrations/config";

describe("UT-07 agent behaviour settings", () => {
  it("UT-07.01 keeps professional tone", () => {
    expect(normalizeAgentTone("PROFESSIONAL")).toBe("PROFESSIONAL");
  });

  it("UT-07.02 normalises unsupported tone to friendly", () => {
    expect(normalizeAgentTone("SHOUTY")).toBe("FRIENDLY");
  });

  it("UT-07.03 defaults response length to balanced", () => {
    expect(normalizeResponseLength(undefined)).toBe("BALANCED");
  });

  it("UT-07.04 builds empathetic short-response instructions", () => {
    expect(buildBehaviourInstructions("EMPATHETIC", "SHORT")).toMatch(
      /feelings[\s\S]*1-3 short sentences/,
    );
  });

  it("UT-07.05 clamps numeric settings to the maximum", () => {
    expect(clampAgentNumber(5, { min: 0, max: 1, fallback: 0.7 })).toBe(1);
  });

  it("UT-07.06 uses the fallback for invalid numeric settings", () => {
    expect(clampAgentNumber("x", { min: 0, max: 1, fallback: 0.7 })).toBe(0.7);
  });

  it("UT-07.07 starts model fallback with the chosen model", () => {
    const chain = getManagedFallbackModels("google/gemini-2.5-flash");

    expect(chain[0]).toBe("google/gemini-2.5-flash");
  });

  it("UT-07.08 includes a managed fallback model", () => {
    const chain = getManagedFallbackModels("google/gemini-2.5-flash");

    expect(chain).toContain("groq/llama-3.3-70b-versatile");
  });

  it("UT-07.09 does not duplicate managed fallback models", () => {
    const chain = getManagedFallbackModels("google/gemini-2.5-flash");

    expect(new Set(chain).size).toBe(chain.length);
  });
});

describe("UT-08 integration secrets", () => {
  it("UT-08.01 encrypts tokens, masks them for the client and keeps them when left blank", () => {
    const first = mergeIntegrationConfig(
      "SLACK",
      { botToken: "xoxb-1234567890-secret", signingSecret: "signing-secret-value" },
      null,
    ) as Prisma.JsonValue;

    expect(JSON.stringify(first)).not.toContain("xoxb-1234567890-secret");
    expect(readIntegrationConfig("SLACK", first).botToken).toBe("xoxb-1234567890-secret");
    expect(maskIntegrationConfig("SLACK", first).botToken).toBe("xoxb••••cret");

    const edited = mergeIntegrationConfig(
      "SLACK",
      { botToken: "", signingSecret: "" },
      first,
    ) as Prisma.JsonValue;
    expect(readIntegrationConfig("SLACK", edited).botToken).toBe("xoxb-1234567890-secret");
  });
});

describe("UT-09 LLM reply sanity check", () => {
  it("UT-09.01 rejects moderation safety output", () => {
    expect(isUnusableReply("User Safety: safe Response Safety: safe")).toBe(true);
  });

  it("UT-09.02 rejects unsafe moderation output", () => {
    expect(isUnusableReply("unsafe\nS2")).toBe(true);
  });

  it("UT-09.03 rejects a bare safety result", () => {
    expect(isUnusableReply("safe")).toBe(true);
  });

  it("UT-09.04 accepts a normal refund answer", () => {
    expect(isUnusableReply("Refunds are processed within 5 business days.")).toBe(false);
  });

  it("UT-09.05 accepts a normal shipping answer", () => {
    expect(isUnusableReply("Safe shipping is guaranteed on all orders.")).toBe(false);
  });
});
