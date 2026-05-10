import { prisma } from "./prisma";
import {
  fetchKnowledgeSourceText,
  retrieveVectorMatches,
} from "./knowledge-indexing";

export type RuntimeKnowledgeSource = {
  id: string;
  title: string;
  type: "FILE" | "URL" | "TEXT";
  status: string;
  sourceUrl: string | null;
  rawText: string | null;
};

type RetrievedMatch = {
  sourceId: string;
  title: string;
  excerpt: string;
  score: number;
};

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function splitIntoPassages(value: string, maxLength = 650) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  const sentences = normalized.split(/(?<=[.!?])\s+/);
  const passages: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + " " + sentence).trim().length > maxLength && current) {
      passages.push(current.trim());
      current = sentence;
      continue;
    }

    current = `${current} ${sentence}`.trim();
  }

  if (current) {
    passages.push(current.trim());
  }

  return passages.length > 0 ? passages : [normalized.slice(0, maxLength)];
}

function splitIntoSentences(value: string) {
  return value
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function scorePassage(question: string, passage: string) {
  const questionTokens = tokenize(question);

  if (questionTokens.length === 0) {
    return 0;
  }

  const passageTokens = new Set(tokenize(passage));
  let hits = 0;

  for (const token of questionTokens) {
    if (passageTokens.has(token)) {
      hits += 1;
    }
  }

  const normalizedQuestion = question.trim().toLowerCase();
  let score = hits / questionTokens.length;

  if (normalizedQuestion && passage.toLowerCase().includes(normalizedQuestion)) {
    score += 0.25;
  }

  return Math.min(1, score);
}

function detectGreeting(question: string) {
  return /^(hi|hello|hey|oi|assalam|salam)\b/.test(question.trim().toLowerCase());
}

function buildExtractiveAnswer(question: string, matches: RetrievedMatch[]) {
  const candidates = matches.flatMap((match) =>
    splitIntoSentences(match.excerpt).map((sentence) => ({
      sentence,
      score: scorePassage(question, sentence),
    })),
  );

  const ranked = candidates
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .filter(
      (candidate, index, array) =>
        array.findIndex(
          (entry) =>
            entry.sentence.toLowerCase() === candidate.sentence.toLowerCase(),
        ) === index,
    )
    .slice(0, 3);

  if (ranked.length === 0) {
    return "";
  }

  return `Based on the connected knowledge sources:\n${ranked
    .map((item) => `- ${item.sentence}`)
    .join("\n")}`;
}

async function retrieveExtractiveMatches(
  question: string,
  sources: RuntimeKnowledgeSource[],
) {
  const matches: RetrievedMatch[] = [];

  for (const source of sources) {
    if (!source.rawText || source.status === "DELETED") {
      continue;
    }

    const passages = splitIntoPassages(source.rawText);

    for (const passage of passages) {
      const score = scorePassage(question, passage);

      if (score <= 0) {
        continue;
      }

      matches.push({
        sourceId: source.id,
        title: source.title,
        excerpt: passage.length > 360 ? `${passage.slice(0, 360)}...` : passage,
        score,
      });
    }
  }

  return matches.sort((left, right) => right.score - left.score).slice(0, 3);
}

export async function hydrateKnowledgeSources(
  sources: RuntimeKnowledgeSource[],
) {
  return Promise.all(
    sources.map(async (source) => {
      if (
        source.type !== "URL" ||
        !source.sourceUrl ||
        (source.rawText && source.rawText.trim().length > 0)
      ) {
        return source;
      }

      try {
        const fetchedText = await fetchKnowledgeSourceText(source.sourceUrl);

        await prisma.knowledgeSource.update({
          where: {
            id: source.id,
          },
          data: {
            rawText: fetchedText,
            status: "SYNCED",
            lastSyncedAt: new Date(),
          },
        });

        return {
          ...source,
          rawText: fetchedText,
          status: "SYNCED",
        };
      } catch (error) {
        await prisma.knowledgeSource.update({
          where: {
            id: source.id,
          },
          data: {
            status: "FAILED",
            processingError:
              error instanceof Error
                ? error.message
                : "Unable to hydrate this URL source.",
          },
        });

        return {
          ...source,
          status: "FAILED",
        };
      }
    }),
  );
}

export async function retrieveKnowledgeMatches(
  question: string,
  sources: RuntimeKnowledgeSource[],
) {
  const vectorMatches = await retrieveVectorMatches({
    question,
    sourceIds: sources.map((source) => source.id),
  });

  if (vectorMatches.length > 0) {
    return vectorMatches
      .map((match) => ({
        sourceId: match.sourceId,
        title: match.title,
        excerpt: match.excerpt,
        score: Math.min(1, match.score),
      }))
      .slice(0, 3);
  }

  return retrieveExtractiveMatches(question, sources);
}

export function estimateTokenUsage(...parts: Array<string | null | undefined>) {
  const text = parts.filter(Boolean).join(" ");
  return Math.max(1, Math.ceil(text.length / 4));
}

export async function generateGroundedAgentReply({
  question,
  confidenceThreshold,
  sources,
}: {
  question: string;
  confidenceThreshold: number;
  sources: RuntimeKnowledgeSource[];
}) {
  const matches = await retrieveKnowledgeMatches(question, sources);
  const topMatch = matches[0];
  const confidence = topMatch?.score ?? 0;

  if (!topMatch) {
    if (detectGreeting(question)) {
      return {
        reply:
          "Hello. I’m ready to help. Ask me a support question related to the connected knowledge sources and I’ll answer from that information.",
        confidence: 1,
        matches,
        tokens: estimateTokenUsage(question),
        usedSourceIds: [],
      };
    }

    return {
      reply:
        "I could not find any matching information in the connected knowledge sources yet. Add a text source or a readable URL source and try again.",
      confidence,
      matches,
      tokens: estimateTokenUsage(question),
      usedSourceIds: [],
    };
  }

  const usedSourceIds = Array.from(new Set(matches.map((match) => match.sourceId)));

  if (confidence < confidenceThreshold) {
    const partialAnswer =
      buildExtractiveAnswer(question, matches) ||
      `Most relevant source: **${topMatch.title}**\n${topMatch.excerpt}`;

    return {
      reply: `I found some partially related information, but not enough to answer confidently.\n\n${partialAnswer}`,
      confidence,
      matches,
      tokens: estimateTokenUsage(question, partialAnswer),
      usedSourceIds,
    };
  }

  const conciseAnswer =
    buildExtractiveAnswer(question, matches) ||
    `Based on the connected knowledge sources:\n- ${topMatch.excerpt}`;

  return {
    reply: conciseAnswer,
    confidence,
    matches,
    tokens: estimateTokenUsage(question, conciseAnswer),
    usedSourceIds,
  };
}

export { fetchKnowledgeSourceText };
