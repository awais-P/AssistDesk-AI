import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { signPayload } from "./secrets";

/**
 * Shared fixed-window rate limiter (Module 5 FE-6, SRS: "block further requests
 * for the throttle window; return 429 Too Many Requests; log the breach").
 *
 * One row per key in PostgreSQL, updated with a single atomic upsert, so limits
 * hold across restarts and across multiple server instances.
 */

export type RateLimitPolicy = {
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

/** Default policies. Widget-per-session comes from the chatbot's own setting. */
export const RATE_LIMITS = {
  widgetMessagePerIp: { limit: 30, windowSeconds: 60 },
  widgetMessagePerWidget: { limit: 600, windowSeconds: 60 },
  widgetNewSessionPerIp: { limit: 10, windowSeconds: 60 * 60 },
  widgetAttachmentPerIp: { limit: 10, windowSeconds: 60 },
  channelMessagePerConversation: { limit: 20, windowSeconds: 60 },
  emailInboundPerIntegration: { limit: 60, windowSeconds: 60 },
  loginPerIdentifier: { limit: 5, windowSeconds: 10 * 60 },
  loginPerIp: { limit: 30, windowSeconds: 10 * 60 },
  signupPerIp: { limit: 5, windowSeconds: 60 * 60 },
  aiTestPerUser: { limit: 30, windowSeconds: 60 },
} satisfies Record<string, RateLimitPolicy>;

export function clampRateLimitPerMinute(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(120, Math.max(1, Math.round(parsed))) : 10;
}

/** Stores a keyed hash of the client IP, never the raw address. */
export function hashClientIp(ip: string) {
  return signPayload("client-ip", ip).slice(0, 32);
}

export function getRequestIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "local"
  );
}

type BucketRow = { count: number; windowStart: Date };

function buildResult(row: BucketRow, policy: RateLimitPolicy, now = Date.now()): RateLimitResult {
  const windowEndsAt = new Date(row.windowStart).getTime() + policy.windowSeconds * 1000;
  const count = Number(row.count);

  return {
    allowed: count <= policy.limit,
    count,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((windowEndsAt - now) / 1000)),
  };
}

let lastCleanup = 0;

async function cleanupOldBuckets() {
  if (Date.now() - lastCleanup < 10 * 60 * 1000) {
    return;
  }

  lastCleanup = Date.now();

  try {
    await prisma.rateLimitBucket.deleteMany({
      where: { updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
  } catch (error) {
    console.error("[rate-limit] Cleanup failed:", error);
  }
}

/**
 * Counts one request against `key` and reports whether it is within the policy.
 * If the database is unreachable the request is allowed (fail open) and logged,
 * so an outage of the limiter never takes the whole assistant down.
 *
 * Prisma stores DateTime columns as UTC `timestamp` values, so the SQL clock is read
 * as `NOW() AT TIME ZONE 'UTC'`; plain NOW() would follow the database's time zone.
 */
export async function consumeRateLimit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
  try {
    const rows = await prisma.$queryRaw<BucketRow[]>`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count", "updatedAt")
      VALUES (${key}, (NOW() AT TIME ZONE 'UTC'), 1, (NOW() AT TIME ZONE 'UTC'))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitBucket"."windowStart" <= (NOW() AT TIME ZONE 'UTC') - (${policy.windowSeconds}::int * INTERVAL '1 second') THEN 1
          ELSE "RateLimitBucket"."count" + 1
        END,
        "windowStart" = CASE
          WHEN "RateLimitBucket"."windowStart" <= (NOW() AT TIME ZONE 'UTC') - (${policy.windowSeconds}::int * INTERVAL '1 second') THEN (NOW() AT TIME ZONE 'UTC')
          ELSE "RateLimitBucket"."windowStart"
        END,
        "updatedAt" = (NOW() AT TIME ZONE 'UTC')
      RETURNING "count", "windowStart"
    `;

    void cleanupOldBuckets();

    return buildResult(rows[0], policy);
  } catch (error) {
    console.error(`[rate-limit] Failed to check "${key}", allowing the request:`, error);
    return { allowed: true, count: 0, limit: policy.limit, remaining: policy.limit, retryAfterSeconds: 0 };
  }
}

/** Reads the current count without counting a request (used before a login attempt). */
export async function peekRateLimit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
  try {
    const bucket = await prisma.rateLimitBucket.findUnique({ where: { key } });

    if (!bucket || bucket.windowStart.getTime() <= Date.now() - policy.windowSeconds * 1000) {
      return { allowed: true, count: 0, limit: policy.limit, remaining: policy.limit, retryAfterSeconds: 0 };
    }

    // The next request would be count + 1.
    const result = buildResult({ count: bucket.count + 1, windowStart: bucket.windowStart }, policy);
    return { ...result, count: bucket.count };
  } catch (error) {
    console.error(`[rate-limit] Failed to read "${key}":`, error);
    return { allowed: true, count: 0, limit: policy.limit, remaining: policy.limit, retryAfterSeconds: 0 };
  }
}

export async function resetRateLimit(key: string) {
  await prisma.rateLimitBucket.deleteMany({ where: { key } }).catch(() => undefined);
}

export function rateLimitHeaders(result: RateLimitResult) {
  return {
    "Retry-After": String(result.retryAfterSeconds),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
  };
}

export function formatRetryAfter(seconds: number) {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }

  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function tooManyRequests(result: RateLimitResult, message: string) {
  return NextResponse.json(
    { error: `${message} Please wait ${formatRetryAfter(result.retryAfterSeconds)} and try again.`, retryAfterSeconds: result.retryAfterSeconds },
    { status: 429, headers: rateLimitHeaders(result) },
  );
}
