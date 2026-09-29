/**
 * Text embeddings for the knowledge base (Module 10 FE-1 / SRS SI-5).
 *
 * Model ids are "<provider>:<model>":
 *  - openrouter:openai/text-embedding-3-small  (default, uses the managed OpenRouter key)
 *  - google:gemini-embedding-001                (uses the managed Google key)
 *  - openai:text-embedding-3-small              (uses OPENAI_API_KEY)
 *  - lexical-hash-v2                            (offline keyword hashing, last resort)
 */

export const LEXICAL_EMBEDDING_MODEL = "lexical-hash-v2";
const LEXICAL_DIMENSIONS = 256;
const BATCH_SIZE = 64;
const REQUEST_TIMEOUT_MS = 25_000;

const stopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from",
  "how", "i", "if", "in", "is", "it", "me", "my", "of", "on", "or", "our", "so", "that",
  "the", "this", "to", "was", "we", "what", "when", "where", "which", "who", "why",
  "will", "with", "you", "your",
]);

/** Unicode-aware tokenizer (keeps Urdu, Arabic and accented words). */
export function tokenizeForSearch(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => {
      if (!token || stopWords.has(token)) {
        return false;
      }

      return /^[a-z0-9]+$/.test(token) ? token.length > 2 : token.length > 1;
    });
}

export function getConfiguredEmbeddingModel() {
  const configured = process.env.ASSISTDESK_EMBEDDING_MODEL?.trim();

  if (configured) {
    return configured;
  }

  if (process.env.ASSISTDESK_DEFAULT_OPENROUTER_API_KEY?.trim()) {
    return "openrouter:openai/text-embedding-3-small";
  }

  if (process.env.ASSISTDESK_DEFAULT_GOOGLE_API_KEY?.trim()) {
    return "google:gemini-embedding-001";
  }

  if (process.env.OPENAI_API_KEY?.trim()) {
    return "openai:text-embedding-3-small";
  }

  return LEXICAL_EMBEDDING_MODEL;
}

export function isSemanticModel(model: string | null | undefined) {
  return Boolean(model && model !== LEXICAL_EMBEDDING_MODEL && model.includes(":"));
}

function hashToken(token: string, seed: number, modulo: number) {
  let hash = seed;

  for (let index = 0; index < token.length; index += 1) {
    hash = (Math.imul(hash, 31) + token.charCodeAt(index)) >>> 0;
  }

  return hash % modulo;
}

function normalize(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}

export function lexicalEmbedding(text: string) {
  const vector = new Array<number>(LEXICAL_DIMENSIONS).fill(0);

  for (const token of tokenizeForSearch(text)) {
    vector[hashToken(token, 7, LEXICAL_DIMENSIONS)] += hashToken(token, 17, 2) === 0 ? 1 : -1;
  }

  return normalize(vector);
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) {
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

  return leftMagnitude === 0 || rightMagnitude === 0
    ? 0
    : dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

async function postJson<T>(url: string, headers: Record<string, string>, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string } | string;
  };

  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : data.error?.message;
    throw new Error(message || `Embedding request failed (${response.status}).`);
  }

  return data;
}

async function embedOpenAiCompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  texts: string[],
  extraHeaders: Record<string, string> = {},
) {
  const data = await postJson<{ data?: Array<{ embedding: number[]; index: number }> }>(
    endpoint,
    { Authorization: `Bearer ${apiKey}`, ...extraHeaders },
    { model, input: texts },
  );
  const rows = [...(data.data ?? [])].sort((left, right) => left.index - right.index);

  if (rows.length !== texts.length) {
    throw new Error("The embedding provider returned an unexpected number of vectors.");
  }

  return rows.map((row) => row.embedding);
}

async function embedGoogle(apiKey: string, model: string, texts: string[]) {
  const data = await postJson<{ embeddings?: Array<{ values: number[] }> }>(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`,
    { "x-goog-api-key": apiKey },
    {
      requests: texts.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
      })),
    },
  );

  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error("Google returned an unexpected number of embeddings.");
  }

  return data.embeddings.map((embedding) => embedding.values);
}

async function embedBatch(model: string, texts: string[]) {
  if (!isSemanticModel(model)) {
    return texts.map(lexicalEmbedding);
  }

  const separator = model.indexOf(":");
  const provider = model.slice(0, separator);
  const modelName = model.slice(separator + 1);

  if (provider === "openrouter") {
    const apiKey = process.env.ASSISTDESK_DEFAULT_OPENROUTER_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("ASSISTDESK_DEFAULT_OPENROUTER_API_KEY is not set.");
    }

    return embedOpenAiCompatible("https://openrouter.ai/api/v1/embeddings", apiKey, modelName, texts, {
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://assistdesk.ai",
      "X-Title": "AssistDesk",
    });
  }

  if (provider === "google") {
    const apiKey = process.env.ASSISTDESK_DEFAULT_GOOGLE_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("ASSISTDESK_DEFAULT_GOOGLE_API_KEY is not set.");
    }

    return embedGoogle(apiKey, modelName, texts);
  }

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set.");
    }

    return embedOpenAiCompatible("https://api.openai.com/v1/embeddings", apiKey, modelName, texts);
  }

  throw new Error(`Unknown embedding provider "${provider}".`);
}

/**
 * Embeds texts with the given model, in batches, retrying a failed batch once.
 */
export async function embedTexts(texts: string[], model = getConfiguredEmbeddingModel()) {
  const vectors: number[][] = [];

  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE).map((text) => text.slice(0, 8000));

    try {
      vectors.push(...(await embedBatch(model, batch)));
    } catch (error) {
      console.error(`[embeddings] ${model} batch failed, retrying once:`, error);
      vectors.push(...(await embedBatch(model, batch)));
    }
  }

  return { model, vectors };
}

/**
 * Embeds document chunks with the configured semantic model, falling back to the
 * offline lexical model if the provider is unavailable so indexing never blocks.
 */
export async function embedDocumentChunks(texts: string[]) {
  const model = getConfiguredEmbeddingModel();

  try {
    return { ...(await embedTexts(texts, model)), warning: null as string | null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      ...(await embedTexts(texts, LEXICAL_EMBEDDING_MODEL)),
      warning: `Semantic embeddings unavailable (${message}); keyword search is used until the next re-sync.`,
    };
  }
}
