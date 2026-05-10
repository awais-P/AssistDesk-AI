import { prisma } from "./prisma";

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

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function stripHtml(html: string) {
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6|br)>/gi, "\n");

  return decodeHtmlEntities(withBreaks)
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
  const normalized = question.trim().toLowerCase();
  return /^(hi|hello|hey|oi|assalam|salam)\b/.test(normalized);
}

function buildExtractiveAnswer(question: string, matches: RetrievedMatch[]) {
  const candidates = matches.flatMap((match) =>
    splitIntoSentences(match.excerpt).map((sentence) => ({
      sentence,
      title: match.title,
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

  const answerLines = ranked.map((item) => `- ${item.sentence}`);
  return `Based on the connected knowledge sources:\n${answerLines.join("\n")}`;
}

export async function fetchKnowledgeSourceText(sourceUrl: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new Error("Please enter a valid URL.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": "AssistDeskBot/1.0 (+https://assistdesk.local)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Unable to fetch this URL (${response.status}).`);
    }

    const html = await response.text();
    const text = stripHtml(html).slice(0, 50000);

    if (text.length < 120) {
      throw new Error("The page did not return enough readable content.");
    }

    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The URL took too long to respond.");
    }

    throw error instanceof Error
      ? error
      : new Error("Unable to fetch the URL content.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function hydrateKnowledgeSources(
  sources: RuntimeKnowledgeSource[],
) {
  const hydratedSources = await Promise.all(
    sources.map(async (source) => {
      if (
        source.type !== "URL" ||
        !source.sourceUrl ||
        (source.rawText && source.status === "SYNCED")
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
      } catch {
        await prisma.knowledgeSource.update({
          where: {
            id: source.id,
          },
          data: {
            status: "FAILED",
          },
        });

        return {
          ...source,
          status: "FAILED",
        };
      }
    }),
  );

  return hydratedSources;
}

export function retrieveKnowledgeMatches(
  question: string,
  sources: RuntimeKnowledgeSource[],
) {
  const matches: RetrievedMatch[] = [];

  for (const source of sources) {
    if (!source.rawText || source.status !== "SYNCED") {
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
        excerpt: passage.slice(0, 360),
        score,
      });
    }
  }

  return matches.sort((left, right) => right.score - left.score).slice(0, 3);
}

export function estimateTokenUsage(...parts: Array<string | null | undefined>) {
  const text = parts.filter(Boolean).join(" ");
  return Math.max(1, Math.ceil(text.length / 4));
}

export function generateGroundedAgentReply({
  question,
  confidenceThreshold,
  sources,
}: {
  question: string;
  confidenceThreshold: number;
  sources: RuntimeKnowledgeSource[];
}) {
  const matches = retrieveKnowledgeMatches(question, sources);
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
