import { NextResponse } from "next/server";
import { safeEqual } from "@/src/lib/secrets";
import { processDueDeliveries } from "@/src/lib/webhooks";

export const dynamic = "force-dynamic";

/**
 * Sends webhook retries that are due (Module 8 FE-4: up to 3 retries with backoff).
 * Call every minute with `Authorization: Bearer $CRON_SECRET`. The Leads page also
 * sends due retries while it is open, so local demos work without a scheduler.
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
  const processed = await processDueDeliveries({ limit: 50 });

  return NextResponse.json({ success: true, processed, durationMs: Date.now() - startedAt });
}

export const GET = run;
export const POST = run;
