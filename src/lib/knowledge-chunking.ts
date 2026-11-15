export const CHUNK_TARGET_CHARS = 1000;
export const CHUNK_OVERLAP_CHARS = 150;
const MAX_CHUNKS_PER_SOURCE = 1500;

export type KnowledgeChunkDraft = {
  content: string;
  heading: string | null;
};

const headingPattern = /^(#{1,6}\s+.+|[A-Z\p{Lu}][^.!?\n]{2,80}:?)$/u;

function splitSentences(paragraph: string) {
  return paragraph
    .split(/(?<=[.!?؟۔])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isHeading(line: string) {
  const trimmed = line.trim();
  return trimmed.length <= 90 && headingPattern.test(trimmed) && !/[.,;]$/.test(trimmed);
}

/** Mostly bullets or short lines ("React development"): a list, not hard-wrapped prose. */
function isListBlock(lines: string[]) {
  const listLines = lines.filter((line) => /^(?:[-*•▪◦●–]|\d{1,2}[.)])\s/.test(line) || line.length <= 50);
  return lines.length >= 3 && listLines.length >= lines.length / 2;
}

function tailOverlap(text: string) {
  if (text.length <= CHUNK_OVERLAP_CHARS) {
    return text;
  }

  const tail = text.slice(-CHUNK_OVERLAP_CHARS);
  const sentenceStart = tail.search(/(?<=[.!?])\s/);
  return (sentenceStart >= 0 ? tail.slice(sentenceStart) : tail.slice(tail.indexOf(" ") + 1)).trim();
}

function splitLongPiece(piece: string) {
  if (piece.length <= CHUNK_TARGET_CHARS * 1.5) {
    return [piece];
  }

  // A single enormous sentence is hard-split so no chunk grows unbounded.
  return piece.match(new RegExp(`.{1,${CHUNK_TARGET_CHARS}}(\\s|$)`, "gs")) ?? [piece];
}

/**
 * Splits a document into section-aware chunks of up to ~1000 characters.
 * A heading always starts a new chunk (sections are never mixed, which keeps
 * embeddings focused); long sections are split on sentence boundaries with ~150
 * characters of overlap. Each chunk records the heading of its section.
 */
export function chunkDocument(text: string): KnowledgeChunkDraft[] {
  const blocks = text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((block) => block.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const chunks: KnowledgeChunkDraft[] = [];
  let heading: string | null = null;
  let current = "";
  let hasNewContent = false;

  const pushCurrent = () => {
    const content = current.trim();

    if (content && hasNewContent) {
      chunks.push({ content, heading });
    }
  };

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);

    if (lines.length === 1 && isHeading(lines[0])) {
      pushCurrent();
      heading = lines[0].replace(/^#+\s*/, "").replace(/:$/, "").trim();
      current = "";
      hasNewContent = false;
      continue;
    }

    const pieces =
      block.length <= CHUNK_TARGET_CHARS
        ? [block]
        : isListBlock(lines)
          ? lines.flatMap(splitSentences) // keep a long list one item per line
          : splitSentences(block.replace(/\n/g, " ")); // join hard-wrapped prose first

    let firstPiece = true;

    for (const part of pieces.flatMap(splitLongPiece)) {
      const trimmed = part.trim();

      if (current && current.length + trimmed.length + 1 > CHUNK_TARGET_CHARS) {
        pushCurrent();
        current = tailOverlap(current);
        hasNewContent = false;
      }

      // A blank line keeps paragraphs and sections apart inside a chunk.
      current = current ? `${current}${firstPiece ? "\n\n" : "\n"}${trimmed}` : trimmed;
      hasNewContent = true;
      firstPiece = false;
    }

    if (chunks.length >= MAX_CHUNKS_PER_SOURCE) {
      break;
    }
  }

  pushCurrent();

  return chunks.slice(0, MAX_CHUNKS_PER_SOURCE);
}

/** Text that gets embedded: the source title and section heading give chunks their topic. */
export function chunkEmbeddingText(chunk: KnowledgeChunkDraft, sourceTitle: string) {
  return [sourceTitle, chunk.heading, chunk.content].filter(Boolean).join("\n");
}
