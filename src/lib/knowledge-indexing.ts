import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { after } from "next/server";
import {
  MAX_KNOWLEDGE_FILE_BYTES,
  describeUnsupportedFile,
  detectDocumentKind,
  extractDocumentText,
} from "./document-extract";
import {
  LEXICAL_EMBEDDING_MODEL,
  cosineSimilarity,
  embedDocumentChunks,
  embedTexts,
  isSemanticModel,
  tokenizeForSearch,
} from "./embeddings";
import { chunkDocument, chunkEmbeddingText } from "./knowledge-chunking";
import { createNotification } from "./notifications";
import { prisma } from "./prisma";
import {
  canUsePinecone,
  deleteSourceVectors,
  isPineconeConfigured,
  queryPinecone,
  upsertChunkVectors,
} from "./vector-store";
import {
  type CrawlMode,
  clampMaxPages,
  combineCrawledPages,
  crawlWebsite,
} from "./web-crawler";

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
  crawlMode: string;
  maxPages: number;
};

export type RetrievedChunkMatch = {
  sourceId: string;
  chunkIndex: number;
  title: string;
  excerpt: string;
  score: number;
  semanticScore: number | null;
  keywordScore: number;
};

const MAX_URL_TEXT_LENGTH = 50_000;
const MAX_CRAWL_TEXT_LENGTH = 250_000;
const MAX_FILE_TEXT_LENGTH = 250_000;
const MAX_EXCERPT_CHARS = 1500;
const STALE_PROCESSING_MS = 5 * 60 * 1000;
const KB_STORAGE_ROOT = path.join(process.cwd(), "storage", "knowledge-base");

declare global {
  var knowledgeSourceProcessingQueue: Set<string> | undefined;
}

const processingQueue = global.knowledgeSourceProcessingQueue ?? new Set<string>();
global.knowledgeSourceProcessingQueue = processingQueue;

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\r/g, "").replace(/\t/g, " ").replace(/[ ]{2,}/g, " ").trim();
}

function textToRelativeStoragePath(workspaceId: string, fileName: string) {
  return path
    .join("storage", "knowledge-base", workspaceId, fileName)
    .replaceAll("\\", "/");
}

function resolveStoragePath(storagePath: string) {
  return path.join(process.cwd(), ...storagePath.split("/"));
}

export async function fetchKnowledgeSourceText(sourceUrl: string) {
  const { text } = await fetchUrlSourceText({
    sourceUrl,
    crawlMode: "SINGLE",
    maxPages: 1,
  });

  return text;
}

export async function fetchUrlSourceText({
  sourceUrl,
  crawlMode,
  maxPages,
}: {
  sourceUrl: string;
  crawlMode: string;
  maxPages: number;
}) {
  const mode: CrawlMode = crawlMode === "CRAWL" ? "CRAWL" : "SINGLE";
  const result = await crawlWebsite({
    url: sourceUrl,
    mode,
    maxPages: clampMaxPages(maxPages, mode),
  });
  const text =
    mode === "SINGLE"
      ? result.pages[0].text.slice(0, MAX_URL_TEXT_LENGTH)
      : combineCrawledPages(result.pages, MAX_CRAWL_TEXT_LENGTH);

  if (text.length < 120) {
    throw new Error("The page did not return enough readable content.");
  }

  return {
    text,
    pageCount: result.pages.length,
    engine: result.engine,
  };
}

export function validateKnowledgeUpload(file: File) {
  if (file.size > MAX_KNOWLEDGE_FILE_BYTES) {
    throw new Error(
      `${file.name} is larger than ${Math.round(MAX_KNOWLEDGE_FILE_BYTES / 1024 / 1024)} MB. Upload a smaller file.`,
    );
  }

  if (!detectDocumentKind(file.name, file.type)) {
    throw new Error(describeUnsupportedFile(file.name));
  }
}

export async function saveKnowledgeSourceFile({
  workspaceId,
  file,
}: {
  workspaceId: string;
  file: File;
}): Promise<StoredKnowledgeFile> {
  validateKnowledgeUpload(file);

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

  const buffer = await readFile(resolveStoragePath(source.storagePath));
  const text = await extractDocumentText({
    buffer,
    fileName: source.fileName,
    mimeType: source.mimeType,
  });

  return text.slice(0, MAX_FILE_TEXT_LENGTH);
}

async function buildSourceText(
  source: IndexingSource,
): Promise<{ text: string; pageCount: number }> {
  if (source.type === "TEXT") {
    const content = normalizeWhitespace(source.rawText || "");

    if (!content) {
      throw new Error("This text source does not contain any knowledge content yet.");
    }

    return { text: content, pageCount: 0 };
  }

  if (source.type === "URL") {
    if (!source.sourceUrl) {
      throw new Error("This URL source does not have a website address.");
    }

    const result = await fetchUrlSourceText({
      sourceUrl: source.sourceUrl,
      crawlMode: source.crawlMode,
      maxPages: source.maxPages,
    });

    return { text: result.text, pageCount: result.pageCount };
  }

  return { text: await extractTextFromStoredFile(source), pageCount: 0 };
}

async function readSourceForIndexing(sourceId: string) {
  return prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      type: true,
      status: true,
      sourceUrl: true,
      fileName: true,
      mimeType: true,
      storagePath: true,
      rawText: true,
      crawlMode: true,
      maxPages: true,
      chunkCount: true,
      vectorStore: true,
    },
  });
}

/**
 * Indexing pipeline (Module 10 FE-4): extract text -> chunk -> embed -> store chunks
 * in PostgreSQL and vectors in Pinecone (or PostgreSQL) -> SYNCED / FAILED.
 */
export async function processKnowledgeSourceById(sourceId: string) {
  const source = await readSourceForIndexing(sourceId);

  if (!source || source.status === "DELETED") {
    return null;
  }

  await prisma.knowledgeSource.update({
    where: { id: sourceId },
    data: { status: "PROCESSING", processingError: null },
    select: { id: true },
  });

  try {
    const { text: rawText, pageCount } = await buildSourceText(source);
    const drafts = chunkDocument(rawText);

    if (drafts.length === 0) {
      throw new Error("No readable text was found to index.");
    }

    const contents = drafts.map((draft) =>
      draft.heading && !draft.content.startsWith(draft.heading)
        ? `${draft.heading}\n${draft.content}`
        : draft.content,
    );
    const embedded = await embedDocumentChunks(
      drafts.map((draft) => chunkEmbeddingText(draft, source.title)),
    );
    const dimension = embedded.vectors[0]?.length ?? 0;
    const usePinecone = isSemanticModel(embedded.model) && (await canUsePinecone(dimension));

    // Replace chunks atomically so a concurrent question never sees an empty source.
    await prisma.$transaction([
      prisma.knowledgeChunk.deleteMany({ where: { sourceId } }),
      prisma.knowledgeChunk.createMany({
        data: contents.map((content, index) => ({
          workspaceId: source.workspaceId,
          sourceId,
          chunkIndex: index,
          content,
          // With Pinecone the vector lives in the index; PostgreSQL keeps only the text.
          embedding: usePinecone ? [] : embedded.vectors[index],
          embeddingModel: embedded.model,
          tokenCount: Math.max(1, Math.ceil(content.length / 4)),
        })),
      }),
    ]);

    if (usePinecone) {
      await upsertChunkVectors({
        workspaceId: source.workspaceId,
        sourceId,
        model: embedded.model,
        vectors: embedded.vectors,
        previousChunkCount: source.chunkCount,
      });
    } else if (source.vectorStore === "pinecone") {
      await deleteSourceVectors(source.workspaceId, sourceId, source.chunkCount);
    }

    const updated = await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        rawText,
        status: "SYNCED",
        pageCount,
        chunkCount: contents.length,
        embeddingModel: embedded.model,
        vectorStore: usePinecone ? "pinecone" : "postgres",
        vectorIndexedAt: new Date(),
        lastSyncedAt: new Date(),
        processingError: embedded.warning,
      },
      include: { agent: true },
    });

    if (embedded.warning) {
      await createNotification({
        workspaceId: source.workspaceId,
        type: "KNOWLEDGE_DEGRADED",
        severity: "WARNING",
        title: `"${source.title}" was indexed with keyword search only`,
        body: embedded.warning,
        link: `/dashboard/knowledge-base/${sourceId}`,
        dedupeMinutes: 60,
      });
    }

    return updated;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to process this knowledge source.";

    await prisma.knowledgeChunk.deleteMany({ where: { sourceId } });

    if (source.vectorStore === "pinecone") {
      await deleteSourceVectors(source.workspaceId, sourceId, source.chunkCount);
    }

    await createNotification({
      workspaceId: source.workspaceId,
      type: "KNOWLEDGE_FAILED",
      severity: "ERROR",
      title: `Knowledge source "${source.title}" failed to sync`,
      body: message,
      link: `/dashboard/knowledge-base/${sourceId}`,
    });

    return prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: "FAILED",
        chunkCount: 0,
        vectorIndexedAt: null,
        processingError: message,
      },
      include: { agent: true },
    });
  }
}

function runQueuedJob(sourceId: string) {
  void processKnowledgeSourceById(sourceId)
    .catch((error) => console.error("[knowledge] Indexing job crashed:", error))
    .finally(() => processingQueue.delete(sourceId));
}

/**
 * Queues a source for background indexing. Inside a request it runs after the
 * response is sent (Next.js `after`); anything interrupted by a restart is picked up
 * again by `recoverStaleKnowledgeJobs`.
 */
export function queueKnowledgeSourceProcessing(sourceId: string) {
  if (processingQueue.has(sourceId)) {
    return false;
  }

  processingQueue.add(sourceId);

  try {
    after(() => runQueuedJob(sourceId));
  } catch {
    // Outside a request scope (scripts, tests): run on the next tick instead.
    setTimeout(() => runQueuedJob(sourceId), 0);
  }

  return true;
}

/**
 * Re-queues sources stuck in PENDING/PROCESSING (e.g. after a server restart) and
 * sources still indexed with the first milestone's keyword vectors, a few at a time.
 */
export async function recoverStaleKnowledgeJobs(workspaceId?: string, limit = 5) {
  const stale = await prisma.knowledgeSource.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      OR: [
        { status: "PENDING" },
        { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
        { status: "SYNCED", embeddingModel: null },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true },
  });

  return stale.filter((source) => queueKnowledgeSourceProcessing(source.id)).length;
}

/** Removes a source's vectors from Pinecone (SRS: "embeddings purged from vector DB"). */
export async function purgeKnowledgeSourceVectors(source: {
  workspaceId: string;
  id: string;
  chunkCount: number;
  vectorStore: string | null;
}) {
  if (source.vectorStore === "pinecone") {
    await deleteSourceVectors(source.workspaceId, source.id, source.chunkCount);
  }
}

function keywordCoverage(questionTokens: string[], contentTokens: Set<string>) {
  if (questionTokens.length === 0) {
    return 0;
  }

  let hits = 0;

  for (const token of questionTokens) {
    if (contentTokens.has(token)) {
      hits += 1;
      continue;
    }

    // Light stemming: "refunds" matches "refund", "shipping" matches "shipped".
    const stem = token.length > 5 ? token.slice(0, 5) : null;

    if (stem && [...contentTokens].some((word) => word.startsWith(stem))) {
      hits += 0.8;
    }
  }

  return hits / questionTokens.length;
}

/**
 * Calibrates raw cosine similarity of modern embedding models (unrelated text is
 * <0.2, a passage that answers the question ~0.3-0.5; measured with text-embedding-3-small) onto a 0-1 relevance score.
 */
export function calibrateSemanticScore(cosine: number) {
  return Math.max(0, Math.min(1, (cosine - 0.15) / 0.3));
}

/**
 * Hybrid retrieval (Module 10 FE-2): semantic similarity from the vector store plus
 * keyword coverage, scoped to the agent's sources, top-k with full chunk text.
 */
export async function retrieveVectorMatches({
  question,
  sourceIds,
  topK = 5,
}: {
  question: string;
  sourceIds: string[];
  topK?: number;
}): Promise<RetrievedChunkMatch[]> {
  if (sourceIds.length === 0 || !question.trim()) {
    return [];
  }

  const sources = await prisma.knowledgeSource.findMany({
    where: {
      id: { in: sourceIds },
      status: { in: ["SYNCED", "PROCESSING"] },
      chunkCount: { gt: 0 },
    },
    select: { id: true, title: true, workspaceId: true, embeddingModel: true, vectorStore: true },
  });

  if (sources.length === 0) {
    return [];
  }

  const questionTokens = tokenizeForSearch(question);
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const semanticScores = new Map<string, number>();
  const models = Array.from(
    new Set(
      sources
        .map((source) => source.embeddingModel)
        .filter((model): model is string => isSemanticModel(model)),
    ),
  );

  for (const model of models) {
    const modelSources = sources.filter((source) => source.embeddingModel === model);

    try {
      const {
        vectors: [queryVector],
      } = await embedTexts([question], model);
      const pineconeSources = modelSources.filter((source) => source.vectorStore === "pinecone");
      const postgresSources = modelSources.filter((source) => source.vectorStore !== "pinecone");

      if (pineconeSources.length > 0 && isPineconeConfigured()) {
        const byWorkspace = new Map<string, string[]>();

        for (const source of pineconeSources) {
          byWorkspace.set(source.workspaceId, [
            ...(byWorkspace.get(source.workspaceId) ?? []),
            source.id,
          ]);
        }

        for (const [workspaceId, ids] of byWorkspace) {
          const matches = await queryPinecone({
            workspaceId,
            vector: queryVector,
            sourceIds: ids,
            topK: topK * 3,
          });

          for (const match of matches) {
            semanticScores.set(`${match.sourceId}:${match.chunkIndex}`, match.score);
          }
        }
      }

      if (postgresSources.length > 0) {
        const chunks = await prisma.knowledgeChunk.findMany({
          where: {
            sourceId: { in: postgresSources.map((source) => source.id) },
            embeddingModel: model,
          },
          select: { sourceId: true, chunkIndex: true, embedding: true },
        });

        for (const chunk of chunks) {
          const embedding = Array.isArray(chunk.embedding) ? (chunk.embedding as number[]) : [];
          semanticScores.set(
            `${chunk.sourceId}:${chunk.chunkIndex}`,
            cosineSimilarity(queryVector, embedding),
          );
        }
      }
    } catch (error) {
      // Provider outage: these sources fall back to keyword scoring below.
      console.error(`[knowledge] Query embedding with ${model} failed:`, error);
    }
  }

  const chunks = await prisma.knowledgeChunk.findMany({
    where: { sourceId: { in: sources.map((source) => source.id) } },
    select: {
      sourceId: true,
      chunkIndex: true,
      content: true,
      embeddingModel: true,
      embedding: true,
    },
  });
  const needsLexicalQuery = chunks.some(
    (chunk) => chunk.embeddingModel === LEXICAL_EMBEDDING_MODEL,
  );
  const lexicalQuery = needsLexicalQuery
    ? (await embedTexts([question], LEXICAL_EMBEDDING_MODEL)).vectors[0]
    : null;

  return chunks
    .map((chunk) => {
      const key = `${chunk.sourceId}:${chunk.chunkIndex}`;
      const keywordScore = keywordCoverage(questionTokens, new Set(tokenizeForSearch(chunk.content)));
      const cosine = semanticScores.get(key);
      let semanticScore: number | null = null;
      let score: number;

      if (typeof cosine === "number") {
        semanticScore = calibrateSemanticScore(cosine);
        score = 0.85 * semanticScore + 0.15 * keywordScore;
      } else if (lexicalQuery && chunk.embeddingModel === LEXICAL_EMBEDDING_MODEL) {
        const embedding = Array.isArray(chunk.embedding) ? (chunk.embedding as number[]) : [];
        score = 0.6 * keywordScore + 0.4 * Math.max(0, cosineSimilarity(lexicalQuery, embedding));
      } else {
        score = keywordScore * 0.85;
      }

      return {
        sourceId: chunk.sourceId,
        chunkIndex: chunk.chunkIndex,
        title: sourceMap.get(chunk.sourceId)?.title ?? "Knowledge Source",
        excerpt:
          chunk.content.length > MAX_EXCERPT_CHARS
            ? `${chunk.content.slice(0, MAX_EXCERPT_CHARS)}…`
            : chunk.content,
        score: Math.min(1, score),
        semanticScore,
        keywordScore,
      };
    })
    .filter((match) => match.score > 0.05)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}
