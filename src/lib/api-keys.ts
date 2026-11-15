import { NextResponse } from "next/server";
import { type AuditActor, recordAudit } from "./audit";
import { prisma } from "./prisma";
import { consumeRateLimit, getRequestIp, hashClientIp, rateLimitHeaders } from "./rate-limit";
import { generateToken, signPayload } from "./secrets";

/**
 * Module 11 FE-2: API keys for the public REST API (/api/v1). A key is shown once when
 * it is created; only an HMAC of it is stored, with a short prefix to tell keys apart.
 * Each key has scopes, an optional expiry, a usage counter and its own rate limit.
 */

export { API_KEY_PREFIX, API_RATE_LIMIT, API_SCOPES, API_SCOPE_KEYS, MAX_API_KEYS, type ApiScope } from "./api-keys-public";
import { API_KEY_PREFIX, API_RATE_LIMIT, API_SCOPE_KEYS, type ApiScope } from "./api-keys-public";

export function hashApiKey(key: string) {
  return signPayload("api-key", key);
}

export function generateApiKey() {
  const key = `${API_KEY_PREFIX}${generateToken(30)}`;
  return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 6), keyHash: hashApiKey(key) };
}

/** Validates the create form; returns the clean values or an error. */
export function parseApiKeyInput(body: { name?: unknown; scopes?: unknown; expiresInDays?: unknown }) {
  const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";

  if (name.length < 2 || name.length > 60) {
    return { error: "Give the key a name of 2 to 60 characters, e.g. \"HubSpot sync\"." } as const;
  }

  if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
    return { error: "Choose at least one permission for the key." } as const;
  }

  const scopes = [...new Set(body.scopes.filter((scope): scope is string => typeof scope === "string"))];
  const unknown = scopes.filter((scope) => !API_SCOPE_KEYS.includes(scope as ApiScope));

  if (unknown.length > 0) {
    return { error: `Unknown permission: ${unknown.join(", ")}` } as const;
  }

  let expiresAt: Date | null = null;

  if (body.expiresInDays !== undefined && body.expiresInDays !== null && body.expiresInDays !== "") {
    const days = Number(body.expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > 730) {
      return { error: "Expiry must be between 1 and 730 days, or never." } as const;
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  return { value: { name, scopes: scopes as ApiScope[], expiresAt } } as const;
}

export type ApiContext = {
  keyId: string;
  keyName: string;
  workspaceId: string;
  scopes: ApiScope[];
  actor: AuditActor;
  headers: Record<string, string>;
};

export function apiError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

function readKey(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  return bearer ?? request.headers.get("x-api-key")?.trim() ?? "";
}

/**
 * Authenticates a public API request and checks the scope. Returns the context, or the
 * error response to send (401 no/invalid key, 403 missing scope, 429 rate limit).
 */
export async function authenticateApi(request: Request, scope: ApiScope | null): Promise<ApiContext | NextResponse> {
  const key = readKey(request);

  if (!key.startsWith(API_KEY_PREFIX)) {
    return apiError(401, "unauthorized", "Send your API key as `Authorization: Bearer ad_live_…`.");
  }

  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(key) },
    select: { id: true, name: true, workspaceId: true, scopes: true, revokedAt: true, expiresAt: true },
  });

  if (!record || record.revokedAt) {
    return apiError(401, "unauthorized", "This API key is not valid or was revoked.");
  }

  if (record.expiresAt && record.expiresAt <= new Date()) {
    return apiError(401, "key_expired", "This API key has expired. Create a new one in AssistDesk → API Keys.");
  }

  const limit = await consumeRateLimit(`api-key:${record.id}`, API_RATE_LIMIT);
  const { "Retry-After": retryAfter, ...headers } = rateLimitHeaders(limit);

  if (!limit.allowed) {
    return apiError(429, "rate_limited", `Too many requests: up to ${API_RATE_LIMIT.limit} per minute per key.`, { ...headers, "Retry-After": retryAfter });
  }

  const actor: AuditActor = { type: "API_KEY", id: record.id, name: `API key "${record.name}"` };

  if (scope && !record.scopes.includes(scope)) {
    await recordAudit({
      workspaceId: record.workspaceId,
      actor,
      action: "access.denied",
      category: "access",
      outcome: "DENIED",
      summary: `API key "${record.name}" lacks the ${scope} permission`,
      metadata: { scope, path: new URL(request.url).pathname },
      request,
    });
    return apiError(403, "missing_scope", `This key does not have the ${scope} permission.`, headers);
  }

  await prisma.apiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date(), lastUsedIpHash: hashClientIp(getRequestIp(request)), usageCount: { increment: 1 } },
    select: { id: true },
  });

  return { keyId: record.id, keyName: record.name, workspaceId: record.workspaceId, scopes: record.scopes as ApiScope[], actor, headers };
}

/** Pagination for list endpoints: `limit` (1–100, default 25) and an opaque `cursor`. */
export function parsePage(url: URL) {
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "25", 10) || 25));
  const cursor = url.searchParams.get("cursor")?.slice(0, 64) || null;
  return { limit, cursor };
}

/** Builds `{ data, nextCursor }` from rows fetched with `take: limit + 1`. */
export function pageResult<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, nextCursor: hasMore ? data[data.length - 1].id : null };
}

export function ok(context: ApiContext, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: context.headers });
}
