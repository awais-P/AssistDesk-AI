import { tokenizeForSearch } from "./embeddings";
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

const tokenize = tokenizeForSearch;

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

const BULLET = /^\s*(?:[-*•▪◦●–]|\d{1,2}[.)])\s+/;
/** Text written for the bot itself (e.g. "Chatbot Response Guidelines"), never quoted to a customer. */
const BOT_INSTRUCTION =
  /\b(?:chat ?bot|assistant|the bot|ai agent)\b[^.\n]{0,80}\b(?:should|must|shall|never|always|do not|don't)\b|\bresponse guidelines?\b|\bsystem prompt\b/i;
const MAX_LINE_LENGTH = 220;
const MAX_LIST_ITEMS = 8;

/** A sentence, or a line that introduces a list together with the list's items. */
type AnswerUnit = { lead: string; items: string[] };

function shorten(text: string) {
  if (text.length <= MAX_LINE_LENGTH) {
    return text;
  }

  const cut = text.slice(0, MAX_LINE_LENGTH);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
}

/**
 * Splits a passage into answer units, keeping line breaks: bullet points and short
 * lines stay attached to the line that introduces them, so a list is quoted as a list
 * instead of one run-on sentence. Instructions written for the bot are left out.
 */
function splitIntoUnits(value: string) {
  const units: AnswerUnit[] = [];
  let current: AnswerUnit | null = null;

  for (const rawLine of value.replace(/\r/g, "").split("\n")) {
    const line = rawLine.replace(BULLET, "").replace(/\s+/g, " ").trim();

    if (!line || BOT_INSTRUCTION.test(line)) {
      current = null;
      continue;
    }

    const isListItem = BULLET.test(rawLine) || (line.length <= 70 && !/[.!?]$/.test(line));

    if (current && isListItem) {
      current.items.push(line);
      continue;
    }

    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      if (sentence && !BOT_INSTRUCTION.test(sentence)) {
        current = { lead: sentence, items: [] };
        units.push(current);
      }
    }
  }

  return units;
}

function formatUnit(unit: AnswerUnit) {
  if (unit.items.length === 0) {
    return `- ${shorten(unit.lead)}`;
  }

  let { lead } = unit;
  let items = unit.items;

  // "UI Design" + "Services include" + items reads as "UI Design. Services include:".
  if (/\b(?:include|includes|including|offer|offers)\s*:?$/i.test(items[0])) {
    lead = `${lead.replace(/[.:]$/, "")}. ${items[0].replace(/:?$/, "")}`;
    items = items.slice(1);
  }

  const shown = items.slice(0, MAX_LIST_ITEMS).map((item) => `- ${shorten(item)}`);

  if (items.length > MAX_LIST_ITEMS) {
    shown.push("- …and more");
  }

  return [`${shorten(lead).replace(/:?$/, ":")}`, ...shown].join("\n");
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

const OFFER_TEAM = "Would you like me to connect you with our team?";

function detectGreeting(question: string) {
  return /^(hi|hello|hey|oi|assalam|salam)\b/.test(question.trim().toLowerCase());
}

/**
 * The answer used when no AI model replies: the units of the retrieved passages that
 * best match the question. A matching list is quoted on its own; otherwise up to three
 * matching sentences.
 */
export function buildExtractiveAnswer(question: string, matches: Array<{ excerpt: string }>) {
  const ranked = matches
    .flatMap((match) => splitIntoUnits(match.excerpt))
    .map((unit) => ({ unit, score: scorePassage(question, [unit.lead, ...unit.items].join(" ")) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .filter(
      (candidate, index, array) =>
        array.findIndex((entry) => entry.unit.lead.toLowerCase() === candidate.unit.lead.toLowerCase()) === index,
    );

  if (ranked.length === 0) {
    return "";
  }

  const best = ranked[0].unit.items.length > 0 ? [ranked[0]] : ranked.filter((entry) => entry.unit.items.length === 0).slice(0, 3);

  return best.map((entry) => formatUnit(entry.unit)).join("\n");
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
        excerpt: passage,
        score,
      });
    }
  }

  return matches.sort((left, right) => right.score - left.score).slice(0, 5);
}

/**
 * Returns the sources that can be used for answering. URL content is fetched by the
 * background indexing job, never at chat time (a customer message must not trigger
 * outbound crawling).
 */
export async function hydrateKnowledgeSources(
  sources: RuntimeKnowledgeSource[],
) {
  return sources.filter((source) => source.status !== "DELETED");
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
    return vectorMatches.map((match) => ({
      sourceId: match.sourceId,
      title: match.title,
      excerpt: match.excerpt,
      score: Math.min(1, match.score),
    }));
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
    return {
      reply: detectGreeting(question)
        ? "Hello! How can I help you today?"
        : `I don't have information about that yet. ${OFFER_TEAM}`,
      confidence: detectGreeting(question) ? 1 : confidence,
      matches,
      tokens: estimateTokenUsage(question),
      usedSourceIds: [],
    };
  }

  const usedSourceIds = Array.from(new Set(matches.map((match) => match.sourceId)));
  const extract = buildExtractiveAnswer(question, matches);

  // Below the threshold (SRS FR-8.5) the closest information is offered as such, never
  // as a confident answer; with nothing quotable the customer is offered the team.
  const reply =
    confidence < confidenceThreshold
      ? extract
        ? `I'm not completely sure, but this is the closest information I have:\n\n${extract}\n\n${OFFER_TEAM}`
        : `I couldn't find a clear answer to that. ${OFFER_TEAM}`
      : extract
        ? `Here's what I found:\n\n${extract}`
        : `I couldn't find a clear answer to that. ${OFFER_TEAM}`;

  return {
    reply,
    confidence,
    matches,
    tokens: estimateTokenUsage(question, reply),
    usedSourceIds,
  };
}

export { fetchKnowledgeSourceText };
