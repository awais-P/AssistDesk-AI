import { describe, expect, it } from "vitest";
import {
  LEXICAL_EMBEDDING_MODEL,
  cosineSimilarity,
  getConfiguredEmbeddingModel,
  isSemanticModel,
  lexicalEmbedding,
  tokenizeForSearch,
} from "@/src/lib/embeddings";
import { CHUNK_TARGET_CHARS, chunkDocument, chunkEmbeddingText } from "@/src/lib/knowledge-chunking";
import { calibrateSemanticScore } from "@/src/lib/knowledge-indexing";

describe("search tokenizer", () => {
  it("keeps non-English words (AI-01) and drops stop words", () => {
    expect(tokenizeForSearch("What is the refund policy?")).toEqual(["refund", "policy"]);
    expect(tokenizeForSearch("واپسی کی پالیسی کیا ہے")).toEqual(
      expect.arrayContaining(["واپسی", "پالیسی"]),
    );
    expect(tokenizeForSearch("Café crème brûlée")).toEqual(["café", "crème", "brûlée"]);
  });
});

describe("lexical fallback embeddings", () => {
  it("scores related text higher than unrelated text", () => {
    const question = lexicalEmbedding("refund policy for shoes");
    const related = lexicalEmbedding("Our refund policy lets you return shoes within 30 days");
    const unrelated = lexicalEmbedding("Support hours are nine to six on weekdays");

    expect(cosineSimilarity(question, related)).toBeGreaterThan(cosineSimilarity(question, unrelated));
    expect(isSemanticModel(LEXICAL_EMBEDDING_MODEL)).toBe(false);
    expect(isSemanticModel("openrouter:openai/text-embedding-3-small")).toBe(true);
  });

  it("uses a semantic model whenever a managed key is configured", () => {
    const previous = process.env.ASSISTDESK_DEFAULT_OPENROUTER_API_KEY;
    process.env.ASSISTDESK_DEFAULT_OPENROUTER_API_KEY = "test";
    expect(getConfiguredEmbeddingModel()).toBe("openrouter:openai/text-embedding-3-small");
    process.env.ASSISTDESK_DEFAULT_OPENROUTER_API_KEY = previous;
  });
});

describe("chunking", () => {
  const document = [
    "Refund Policy",
    "",
    "Customers can return unworn shoes within 30 days for a full refund. ".repeat(12),
    "",
    "Shipping",
    "",
    "Standard delivery inside Pakistan takes 3 to 5 days. Orders over 5000 PKR ship free. ".repeat(8),
  ].join("\n");

  it("splits long documents into bounded, overlapping chunks with headings", () => {
    const chunks = chunkDocument(document);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= CHUNK_TARGET_CHARS * 1.6)).toBe(true);
    expect(chunks[0].heading).toBe("Refund Policy");
    expect(chunks.some((chunk) => chunk.heading === "Shipping")).toBe(true);
    expect(chunkEmbeddingText(chunks[0], "Store FAQ")).toMatch(/^Store FAQ\nRefund Policy\n/);
  });

  it("starts a new chunk at every heading and labels it correctly", () => {
    const chunks = chunkDocument(
      "Refund Policy\n\nReturn unworn shoes within 30 days.\n\nShipping\n\nDelivery takes 3 to 5 days.",
    );

    expect(chunks).toEqual([
      { content: "Return unworn shoes within 30 days.", heading: "Refund Policy" },
      { content: "Delivery takes 3 to 5 days.", heading: "Shipping" },
    ]);
  });

  it("keeps short documents as one chunk and ignores empty input", () => {
    expect(chunkDocument("Support hours are 9am to 6pm.")).toEqual([
      { content: "Support hours are 9am to 6pm.", heading: null },
    ]);
    expect(chunkDocument("   \n\n  ")).toEqual([]);
  });
});

describe("semantic score calibration", () => {
  it("maps raw cosine similarity onto a 0-1 relevance scale", () => {
    expect(calibrateSemanticScore(0.1)).toBe(0);
    expect(calibrateSemanticScore(0.3)).toBeCloseTo(0.5, 5);
    expect(calibrateSemanticScore(0.45)).toBeCloseTo(1, 5);
    expect(calibrateSemanticScore(0.9)).toBe(1);
  });
});
