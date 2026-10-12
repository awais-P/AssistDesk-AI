import { NextResponse } from "next/server";
import { recoverStaleKnowledgeJobs } from "@/src/lib/knowledge-indexing";
import { safeEqual } from "@/src/lib/secrets";

/**
 * Scheduled recovery for knowledge indexing (e.g. Vercel Cron every 5 minutes):
 * restarts jobs interrupted by a deploy or restart. Requires `Authorization: Bearer
 * <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  if (!secret || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const requeued = await recoverStaleKnowledgeJobs(undefined, 20);

  return NextResponse.json({ success: true, requeued });
}
