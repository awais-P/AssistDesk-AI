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

describe("agent behaviour settings", () => {
  it("normalises tone and length and builds prompt instructions", () => {
    expect(normalizeAgentTone("PROFESSIONAL")).toBe("PROFESSIONAL");
    expect(normalizeAgentTone("SHOUTY")).toBe("FRIENDLY");
    expect(normalizeResponseLength(undefined)).toBe("BALANCED");
    expect(buildBehaviourInstructions("EMPATHETIC", "SHORT")).toMatch(
      /feelings[\s\S]*1-3 short sentences/,
    );
  });

  it("clamps numeric settings", () => {
    expect(clampAgentNumber(5, { min: 0, max: 1, fallback: 0.7 })).toBe(1);
    expect(clampAgentNumber("x", { min: 0, max: 1, fallback: 0.7 })).toBe(0.7);
  });

  it("fails over across all managed models starting with the chosen one", () => {
    const chain = getManagedFallbackModels("google/gemini-2.5-flash");

    expect(chain[0]).toBe("google/gemini-2.5-flash");
    expect(chain).toContain("groq/llama-3.3-70b-versatile");
    expect(new Set(chain).size).toBe(chain.length);
  });
});

describe("integration secrets", () => {
  it("encrypts tokens, masks them for the client and keeps them when left blank", () => {
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

describe("LLM reply sanity check", () => {
  it("rejects moderation-model output and accepts real answers", () => {
    expect(isUnusableReply("User Safety: safe Response Safety: safe")).toBe(true);
    expect(isUnusableReply("unsafe\nS2")).toBe(true);
    expect(isUnusableReply("safe")).toBe(true);
    expect(isUnusableReply("Refunds are processed within 5 business days.")).toBe(false);
    expect(isUnusableReply("Safe shipping is guaranteed on all orders.")).toBe(false);
  });
});
