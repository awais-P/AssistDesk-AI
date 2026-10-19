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
import { buildExtractiveAnswer, generateGroundedAgentReply, isGreetingOnly } from "@/src/lib/knowledge-runtime";
import { buildRetrievalQuery } from "@/src/lib/llm-runtime";

describe("UT-16 search tokenizer", () => {
  it("UT-16.01 drops English stop words - AI-01", () => {
    expect(tokenizeForSearch("What is the refund policy?")).toEqual(["refund", "policy"]);
  });

  it("UT-16.02 keeps non-English words - AI-01", () => {
    expect(tokenizeForSearch("واپسی کی پالیسی کیا ہے")).toEqual(
      expect.arrayContaining(["واپسی", "پالیسی"]),
    );
  });

  it("UT-16.03 preserves accented words - AI-01", () => {
    expect(tokenizeForSearch("Café crème brûlée")).toEqual(["café", "crème", "brûlée"]);
  });

  it("UT-16.04 keeps two-letter acronyms such as UI - AI-01", () => {
    expect(tokenizeForSearch("I need UI services, what is available?")).toEqual(["need", "ui", "services", "available"]);
  });
});

describe("UT-17 lexical fallback embeddings", () => {
  it("UT-17.01 scores related text higher than unrelated text", () => {
    const question = lexicalEmbedding("refund policy for shoes");
    const related = lexicalEmbedding("Our refund policy lets you return shoes within 30 days");
    const unrelated = lexicalEmbedding("Support hours are nine to six on weekdays");

    expect(cosineSimilarity(question, related)).toBeGreaterThan(cosineSimilarity(question, unrelated));
  });

  it("UT-17.02 recognises the lexical embedding model", () => {
    expect(isSemanticModel(LEXICAL_EMBEDDING_MODEL)).toBe(false);
  });

  it("UT-17.03 recognises a managed semantic embedding model", () => {
    expect(isSemanticModel("openrouter:openai/text-embedding-3-small")).toBe(true);
  });

  it("UT-17.04 uses a semantic model whenever a managed key is configured", () => {
    const previous = process.env.ASSISTDESK_DEFAULT_OPENROUTER_API_KEY;
    process.env.ASSISTDESK_DEFAULT_OPENROUTER_API_KEY = "test";
    expect(getConfiguredEmbeddingModel()).toBe("openrouter:openai/text-embedding-3-small");
    process.env.ASSISTDESK_DEFAULT_OPENROUTER_API_KEY = previous;
  });
});

describe("UT-18 chunking", () => {
  const document = [
    "Refund Policy",
    "",
    "Customers can return unworn shoes within 30 days for a full refund. ".repeat(12),
    "",
    "Shipping",
    "",
    "Standard delivery inside Pakistan takes 3 to 5 days. Orders over 5000 PKR ship free. ".repeat(8),
  ].join("\n");

  it("UT-18.01 splits long documents into bounded, overlapping chunks with headings", () => {
    const chunks = chunkDocument(document);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= CHUNK_TARGET_CHARS * 1.6)).toBe(true);
    expect(chunks[0].heading).toBe("Refund Policy");
    expect(chunks.some((chunk) => chunk.heading === "Shipping")).toBe(true);
    expect(chunkEmbeddingText(chunks[0], "Store FAQ")).toMatch(/^Store FAQ\nRefund Policy\n/);
  });

  it("UT-18.02 starts a new chunk at every heading and labels it correctly", () => {
    const chunks = chunkDocument(
      "Refund Policy\n\nReturn unworn shoes within 30 days.\n\nShipping\n\nDelivery takes 3 to 5 days.",
    );

    expect(chunks).toEqual([
      { content: "Return unworn shoes within 30 days.", heading: "Refund Policy" },
      { content: "Delivery takes 3 to 5 days.", heading: "Shipping" },
    ]);
  });

  it("UT-18.03 keeps short documents as one chunk and ignores empty input", () => {
    expect(chunkDocument("Support hours are 9am to 6pm.")).toEqual([
      { content: "Support hours are 9am to 6pm.", heading: null },
    ]);
    expect(chunkDocument("   \n\n  ")).toEqual([]);
  });
});

describe("UT-19 semantic score calibration", () => {
  it("UT-19.01 maps raw cosine similarity onto a 0-1 relevance scale", () => {
    expect(calibrateSemanticScore(0.1)).toBe(0);
    expect(calibrateSemanticScore(0.3)).toBeCloseTo(0.5, 5);
    expect(calibrateSemanticScore(0.45)).toBeCloseTo(1, 5);
    expect(calibrateSemanticScore(0.9)).toBe(1);
  });
});

describe("UT-48 knowledge-base answer when no AI model replies - FE-1", () => {
  const services = [
    "UI/UX Design and Frontend Development",
    "Services include",
    "Figma wireframes and UI prototypes",
    "Responsive website architecture",
    "Angular development",
    "React development",
    "",
    "Cyber Security",
    "Services include",
    "Vulnerability assessments",
    "Penetration testing",
    "",
    "Chatbot Response Guidelines",
    "The Deltavare chatbot should explain the services clearly and professionally.",
  ].join("\n");

  it("UT-48.01 quotes the matching list as a list", () => {
    expect(buildExtractiveAnswer("i need UI services, What is available", [{ excerpt: services }])).toBe(
      [
        "UI/UX Design and Frontend Development. Services include:",
        "- Figma wireframes and UI prototypes",
        "- Responsive website architecture",
        "- Angular development",
        "- React development",
      ].join("\n"),
    );
  });

  it("UT-48.02 never quotes instructions written for the chatbot", () => {
    const answer = buildExtractiveAnswer("How should the chatbot explain the services?", [{ excerpt: services }]);
    expect(answer).not.toMatch(/chatbot should|Response Guidelines/i);
  });

  it("UT-48.03 shortens a long sentence at a word boundary", () => {
    const long = `Our warranty covers ${"the heating element and the switch and ".repeat(10)}more.`;
    const answer = buildExtractiveAnswer("warranty", [{ excerpt: long }]);
    expect(answer.length).toBeLessThanOrEqual(225);
    expect(answer).toMatch(/\S…$/);
  });

  it("UT-48.04 returns nothing when no line matches the question", () => {
    expect(buildExtractiveAnswer("opening hours", [{ excerpt: services }])).toBe("");
  });

  it("UT-48.07 answers from the matching section of a whole chunked document", () => {
    const document = [
      "Deltavare is a software company that builds websites, apps and digital products for growing businesses.",
      "The team can support projects from the initial idea and planning stage through design, development, testing, deployment, optimization, and maintenance.",
      "",
      "Main Services",
      "UI/UX and Frontend Development",
      "Digital Marketing and SEO",
      "Cybersecurity",
      "",
      "UI/UX and Frontend Development",
      "Deltavare designs and builds modern, responsive interfaces that are fast and easy to use.",
      "Services include:",
      ...["Figma wireframes and UI prototypes", "Responsive website architecture", "Conversion-focused page layouts", "Design systems",
        "Angular development", "React development", "TypeScript development", "SCSS styling", "Frontend performance improvements"].map((item) => `- ${item}`),
      "",
      "Digital Marketing and SEO",
      "Deltavare helps businesses improve their online visibility and attract more customers.",
      "Services include:",
      ...["Search engine optimization", "Social media marketing", "Content strategy", "Google Ads campaigns"].map((item) => `- ${item}`),
      "",
      "Cybersecurity",
      "Services include:",
      ...["Vulnerability assessments", "Security audits", "Penetration testing", "Server hardening"].map((item) => `- ${item}`),
      "",
      "Chatbot Response Guidelines",
      "The Deltavare chatbot should explain Deltavare's services clearly and professionally.",
    ].join("\n");
    const chunks = chunkDocument(document).map((chunk) => ({ excerpt: chunk.content }));

    expect(buildExtractiveAnswer("i need ui services", chunks)).toBe(
      [
        "UI/UX and Frontend Development. Services include:",
        "- Figma wireframes and UI prototypes",
        "- Responsive website architecture",
        "- Conversion-focused page layouts",
        "- Design systems",
        "- Angular development",
        "- React development",
        "- TypeScript development",
        "- SCSS styling",
        "- …and more",
      ].join("\n"),
    );
  });

  it("UT-48.05 recognises a message that is only a greeting", () => {
    for (const greeting of ["hello", "Hi there!", "hey", "Good morning", "Assalam o Alaikum", "salam"]) {
      expect(isGreetingOnly(greeting), greeting).toBe(true);
    }
    expect(isGreetingOnly("hi, what UI services do you offer?")).toBe(false);
  });

  it("UT-48.06 answers hello with a greeting even after a services question", async () => {
    const history = [{ role: "user" as const, content: "i need UI services, What is available" }];
    expect(buildRetrievalQuery("hello", history)).toBe("hello");
    const reply = await generateGroundedAgentReply({ question: "hello", confidenceThreshold: 0.5, sources: [] });
    expect(reply.reply).toBe("Hello! How can I help you today?");
  });
});
