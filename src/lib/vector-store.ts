import { Pinecone } from "@pinecone-database/pinecone";

/**
 * Pinecone vector storage (SRS OE-3 / SI-5), used when PINECONE_API_KEY and
 * PINECONE_INDEX are set. Each workspace gets its own namespace for tenant isolation
 * (SRS SEC-4). Without Pinecone, vectors stay in PostgreSQL (KnowledgeChunk.embedding).
 */

type ChunkVectorMetadata = {
  workspaceId: string;
  sourceId: string;
  chunkIndex: number;
  model: string;
};

export type VectorMatch = {
  sourceId: string;
  chunkIndex: number;
  score: number;
};

declare global {
  var pineconeClient: Pinecone | undefined;
  var pineconeDimensionCache: number | null | undefined;
}

export function isPineconeConfigured() {
  return Boolean(process.env.PINECONE_API_KEY?.trim() && process.env.PINECONE_INDEX?.trim());
}

function getIndex() {
  global.pineconeClient ??= new Pinecone({ apiKey: process.env.PINECONE_API_KEY!.trim() });
  return global.pineconeClient.index<ChunkVectorMetadata>(process.env.PINECONE_INDEX!.trim());
}

async function getIndexDimension() {
  if (global.pineconeDimensionCache !== undefined) {
    return global.pineconeDimensionCache;
  }

  try {
    global.pineconeClient ??= new Pinecone({ apiKey: process.env.PINECONE_API_KEY!.trim() });
    const description = await global.pineconeClient.describeIndex(process.env.PINECONE_INDEX!.trim());
    global.pineconeDimensionCache = description.dimension ?? null;
  } catch (error) {
    console.error("[pinecone] Unable to describe index:", error);
    global.pineconeDimensionCache = null;
  }

  return global.pineconeDimensionCache;
}

export function vectorId(sourceId: string, chunkIndex: number) {
  return `${sourceId}:${chunkIndex}`;
}

/** Whether vectors of this size can go to Pinecone (the index dimension must match). */
export async function canUsePinecone(dimension: number) {
  if (!isPineconeConfigured()) {
    return false;
  }

  const indexDimension = await getIndexDimension();

  if (indexDimension && indexDimension !== dimension) {
    console.warn(
      `[pinecone] Index dimension ${indexDimension} does not match embedding dimension ${dimension}; using PostgreSQL vectors.`,
    );
    return false;
  }

  return Boolean(indexDimension);
}

export async function upsertChunkVectors({
  workspaceId,
  sourceId,
  model,
  vectors,
  previousChunkCount,
}: {
  workspaceId: string;
  sourceId: string;
  model: string;
  vectors: number[][];
  previousChunkCount: number;
}) {
  const index = getIndex();

  for (let start = 0; start < vectors.length; start += 100) {
    await index.upsert({
      namespace: workspaceId,
      records: vectors.slice(start, start + 100).map((values, offset) => ({
        id: vectorId(sourceId, start + offset),
        values,
        metadata: { workspaceId, sourceId, chunkIndex: start + offset, model },
      })),
    });
  }

  // Remove vectors left over from a longer previous version of this source.
  const staleIds = [];

  for (let chunkIndex = vectors.length; chunkIndex < previousChunkCount; chunkIndex += 1) {
    staleIds.push(vectorId(sourceId, chunkIndex));
  }

  if (staleIds.length > 0) {
    await index.deleteMany({ namespace: workspaceId, ids: staleIds });
  }
}

export async function deleteSourceVectors(workspaceId: string, sourceId: string, chunkCount: number) {
  if (!isPineconeConfigured() || chunkCount <= 0) {
    return;
  }

  const ids = Array.from({ length: chunkCount }, (_, chunkIndex) => vectorId(sourceId, chunkIndex));

  try {
    for (let start = 0; start < ids.length; start += 1000) {
      await getIndex().deleteMany({ namespace: workspaceId, ids: ids.slice(start, start + 1000) });
    }
  } catch (error) {
    console.error("[pinecone] Failed to delete vectors for source", sourceId, error);
  }
}

export async function queryPinecone({
  workspaceId,
  vector,
  sourceIds,
  topK,
}: {
  workspaceId: string;
  vector: number[];
  sourceIds: string[];
  topK: number;
}): Promise<VectorMatch[]> {
  const result = await getIndex().query({
    namespace: workspaceId,
    vector,
    topK,
    includeMetadata: true,
    filter: { sourceId: { $in: sourceIds } },
  });

  return (result.matches ?? [])
    .filter((match) => match.metadata)
    .map((match) => ({
      sourceId: match.metadata!.sourceId,
      chunkIndex: Number(match.metadata!.chunkIndex),
      score: match.score ?? 0,
    }));
}
