import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { safeEqual } from "@/src/lib/secrets";
import { expireIdleSessions } from "@/src/lib/session-lifecycle";
import { expireStaleConfirmations } from "@/src/lib/tools/registry";

export const dynamic = "force-dynamic";

/**
 * Scheduled session maintenance (Module 5 FE-5). Call every few minutes from a
 * scheduler (Vercel Cron, GitHub Actions, cron + curl) with
 * `Authorization: Bearer $CRON_SECRET`. Closes sessions past their idle or maximum
 * duration policy (which also writes their summary and the customer's memory) and
 * removes stale rate-limit counters. Sessions also expire lazily when used, so this
 * only makes expiry prompt when nobody is looking.
 */
async function run(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";

  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const startedAt = Date.now();
  let closed = 0;

  // Work through the backlog in batches, but stay well inside a request timeout.
  for (let batch = 0; batch < 5; batch += 1) {
    const count = await expireIdleSessions({ limit: 100 });
    closed += count;

    if (count < 100 || Date.now() - startedAt > 20_000) {
      break;
    }
  }

  const buckets = await prisma.rateLimitBucket.deleteMany({
    where: { updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });

  // Module 2: actions still waiting for a "yes" after the confirmation window.
  const expiredConfirmations = await expireStaleConfirmations();

  return NextResponse.json({
    success: true,
    expiredSessions: closed,
    expiredConfirmations,
    removedRateLimitBuckets: buckets.count,
    durationMs: Date.now() - startedAt,
  });
}

export const GET = run;
export const POST = run;
