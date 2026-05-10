import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";

type StoredKnowledgeFile = {
  fileName: string;
  mimeType: string | null;
  fileSize: number;
  storagePath: string;
};

type IndexingSource = {
  id: string;
  workspaceId: string;
  title: string;
  type: "FILE" | "URL" | "TEXT";
  sourceUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  storagePath: string | null;
  rawText: string | null;
};

type ProcessingResult = {
  rawText: string;
  chunkCount: number;
};

type RetrievedChunkMatch = {
  sourceId: string;
  chunkIndex: number;
  excerpt: string;
  score: number;
};

const MAX_URL_TEXT_LENGTH = 50_000;
const MAX_FILE_TEXT_LENGTH = 80_000;
const EMBEDDING_DIMENSIONS = 96;
const KB_STORAGE_ROOT = path.join(process.cwd(), "storage", "knowledge-base");
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

declare global {
  var knowledgeSourceProcessingQueue: Set<string> | undefined;
}

const processingQueue =
  global.knowledgeSourceProcessingQueue ?? new Set<string>();

if (process.env.NODE_ENV !== "production") {
  global.knowledgeSourceProcessingQueue = processingQueue;
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\r/g, "").replace(/\t/g, " ").replace(/[ ]{2,}/g, " ").trim();
}

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
    .replace(
      /<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6|br|tr)>/gi,
      "\n",
    );

  return decodeHtmlEntities(withBreaks)
    .replace(/<[^>]+>/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function tokenize(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function textToRelativeStoragePath(workspaceId: string, fileName: string) {
  return path
    .join("storage", "knowledge-base", workspaceId, fileName)
    .replaceAll("\\", "/");
}

function resolveStoragePath(storagePath: string) {
  return path.join(process.cwd(), ...storagePath.split("/"));
}

function isTextBasedFile(fileName: string | null, mimeType: string | null) {
  const normalizedName = (fileName || "").toLowerCase();
  const normalizedMime = (mimeType || "").toLowerCase();

  if (
    normalizedMime.startsWith("text/") ||
    normalizedMime.includes("json") ||
    normalizedMime.includes("xml") ||
    normalizedMime.includes("javascript")
  ) {
    return true;
  }

  return [".txt", ".md", ".csv", ".json", ".html", ".htm", ".xml"].some(
    (extension) => normalizedName.endsWith(extension),
  );
}

function hashTokenToIndex(token: string, dimensions: number) {
  let hash = 0;

  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 31 + token.charCodeAt(index)) >>> 0;
  }

  return hash % dimensions;
}

function hashTokenToSign(token: string) {
  let hash = 7;

  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 17 + token.charCodeAt(index)) >>> 0;
  }

  return hash % 2 === 0 ? 1 : -1;
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  );

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

export function buildKnowledgeEmbedding(
  text: string,
  dimensions = EMBEDDING_DIMENSIONS,
) {
  const tokens = tokenize(text);
  const vector = new Array(dimensions).fill(0);

  for (const token of tokens) {
    const index = hashTokenToIndex(token, dimensions);
    vector[index] += hashTokenToSign(token);
  }

  return normalizeVector(vector);
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function chunkKnowledgeText(text: string) {
  const words = normalizeWhitespace(text).split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return [];
  }

  const chunkSize = 180;
  const overlap = 35;
  const chunks: string[] = [];

  for (let start = 0; start < words.length; start += chunkSize - overlap) {
    const chunk = words.slice(start, start + chunkSize).join(" ").trim();

    if (!chunk) {
      continue;
    }

    chunks.push(chunk);

    if (start + chunkSize >= words.length) {
      break;
    }
  }

  return chunks;
}

export async function fetchKnowledgeSourceText(sourceUrl: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new Error("Please enter a valid URL.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

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
    const text = stripHtml(html).slice(0, MAX_URL_TEXT_LENGTH);

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

export async function saveKnowledgeSourceFile({
  workspaceId,
  file,
}: {
  workspaceId: string;
  file: File;
}): Promise<StoredKnowledgeFile> {
  const workspaceDirectory = path.join(KB_STORAGE_ROOT, workspaceId);
  const safeFileName = `${Date.now()}-${sanitizeFileName(file.name || "source")}`;
  const storagePath = textToRelativeStoragePath(workspaceId, safeFileName);
  const absolutePath = resolveStoragePath(storagePath);
  const bytes = Buffer.from(await file.arrayBuffer());

  await mkdir(workspaceDirectory, { recursive: true });
  await writeFile(absolutePath, bytes);

  return {
    fileName: file.name || safeFileName,
    mimeType: file.type || null,
    fileSize: bytes.byteLength,
    storagePath,
  };
}

export async function deleteStoredKnowledgeFile(storagePath: string | null) {
  if (!storagePath) {
    return;
  }

  try {
    await unlink(resolveStoragePath(storagePath));
  } catch {
    // Ignore missing files during cleanup.
  }
}

async function extractTextFromStoredFile(source: IndexingSource) {
  if (!source.storagePath) {
    throw new Error("No stored file is attached to this knowledge source.");
  }

  if (!isTextBasedFile(source.fileName, source.mimeType)) {
    throw new Error(
      "Automatic extraction currently supports TXT, MD, CSV, JSON, HTML, and XML files.",
    );
  }

  const absolutePath = resolveStoragePath(source.storagePath);
  const buffer = await readFile(absolutePath);
  const text = buffer.toString("utf8");
  const normalized = source.mimeType?.includes("html") || source.fileName?.toLowerCase().endsWith(".html")
    ? stripHtml(text)
    : normalizeWhitespace(text);

  if (!normalized) {
    throw new Error("The uploaded file did not contain readable text.");
  }

  return normalized.slice(0, MAX_FILE_TEXT_LENGTH);
}

async function createKnowledgeChunks({
  workspaceId,
  sourceId,
  text,
}: {
  workspaceId: string;
  sourceId: string;
  text: string;
}) {
  const chunks = chunkKnowledgeText(text);

  await prisma.knowledgeChunk.deleteMany({
    where: {
      sourceId,
    },
  });

  if (chunks.length === 0) {
    return 0;
  }

  await prisma.knowledgeChunk.createMany({
    data: chunks.map((content, index) => ({
      workspaceId,
      sourceId,
      chunkIndex: index,
      content,
      embedding: buildKnowledgeEmbedding(content),
      tokenCount: Math.max(1, Math.ceil(content.length / 4)),
    })),
  });

  return chunks.length;
}

async function buildSourceText(source: IndexingSource) {
  if (source.type === "TEXT") {
    const content = normalizeWhitespace(source.rawText || "");

    if (!content) {
      throw new Error("This text source does not contain any knowledge content yet.");
    }

    return content;
  }

  if (source.type === "URL") {
    const existingText = normalizeWhitespace(source.rawText || "");

    if (existingText.length > 120) {
      return existingText;
    }

    if (!source.sourceUrl) {
      throw new Error("This URL source does not have a website address.");
    }

    return fetchKnowledgeSourceText(source.sourceUrl);
  }

  return extractTextFromStoredFile(source);
}

export async function processKnowledgeSourceById(sourceId: string) {
  const source = await prisma.knowledgeSource.findUnique({
    where: {
      id: sourceId,
    },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      type: true,
      sourceUrl: true,
      fileName: true,
      mimeType: true,
      storagePath: true,
      rawText: true,
    },
  });

  if (!source) {
    return null;
  }

  await prisma.knowledgeSource.update({
    where: {
      id: sourceId,
    },
    data: {
      status: "PROCESSING",
      processingError: null,
    },
  });

  try {
    const rawText = await buildSourceText(source);
    const chunkCount = await createKnowledgeChunks({
      workspaceId: source.workspaceId,
      sourceId: source.id,
      text: rawText,
    });

    return prisma.knowledgeSource.update({
      where: {
        id: source.id,
      },
      data: {
        rawText,
        status: "SYNCED",
        chunkCount,
        vectorIndexedAt: new Date(),
        lastSyncedAt: new Date(),
        processingError: null,
      },
      include: {
        agent: true,
      },
    });
  } catch (error) {
    await prisma.knowledgeChunk.deleteMany({
      where: {
        sourceId: source.id,
      },
    });

    return prisma.knowledgeSource.update({
      where: {
        id: source.id,
      },
      data: {
        status: "FAILED",
        chunkCount: 0,
        vectorIndexedAt: null,
        processingError:
          error instanceof Error
            ? error.message
            : "Unable to process this knowledge source.",
      },
      include: {
        agent: true,
      },
    });
  }
}

export function queueKnowledgeSourceProcessing(sourceId: string) {
  if (processingQueue.has(sourceId)) {
    return false;
  }

  processingQueue.add(sourceId);

  setTimeout(() => {
    void processKnowledgeSourceById(sourceId).finally(() => {
      processingQueue.delete(sourceId);
    });
  }, 50);

  return true;
}

export async function retrieveVectorMatches({
  question,
  sourceIds,
}: {
  question: string;
  sourceIds: string[];
}) {
  if (sourceIds.length === 0) {
    return [];
  }

  const [chunks, sources] = await Promise.all([
    prisma.knowledgeChunk.findMany({
      where: {
        sourceId: {
          in: sourceIds,
        },
      },
      orderBy: [{ sourceId: "asc" }, { chunkIndex: "asc" }],
    }),
    prisma.knowledgeSource.findMany({
      where: {
        id: {
          in: sourceIds,
        },
      },
      select: {
        id: true,
        title: true,
      },
    }),
  ]);

  if (chunks.length === 0) {
    return [];
  }

  const sourceMap = new Map(sources.map((source) => [source.id, source.title]));
  const questionEmbedding = buildKnowledgeEmbedding(question);

  const ranked = chunks
    .map((chunk) => {
      const embedding = Array.isArray(chunk.embedding)
        ? (chunk.embedding as number[])
        : [];
      const lexicalBonus = tokenize(question).length
        ? tokenize(question).filter((token) =>
            chunk.content.toLowerCase().includes(token),
          ).length /
          Math.max(1, tokenize(question).length)
        : 0;

      return {
        sourceId: chunk.sourceId,
        chunkIndex: chunk.chunkIndex,
        excerpt:
          chunk.content.length > 360
            ? `${chunk.content.slice(0, 360)}...`
            : chunk.content,
        score: cosineSimilarity(questionEmbedding, embedding) + lexicalBonus * 0.2,
      };
    })
    .filter((chunk) => chunk.score > 0.05)
    .sort((left, right) => right.score - left.score);

  const uniqueMatches = ranked.reduce<RetrievedChunkMatch[]>((accumulator, match) => {
    if (
      accumulator.some(
        (entry) =>
          entry.sourceId === match.sourceId && entry.chunkIndex === match.chunkIndex,
      )
    ) {
      return accumulator;
    }

    accumulator.push(match);
    return accumulator;
  }, []);

  return uniqueMatches.slice(0, 5).map((match) => ({
    ...match,
    title: sourceMap.get(match.sourceId) || "Knowledge Source",
  }));
}
