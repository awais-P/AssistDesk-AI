import { NextResponse } from "next/server";
import { createSampleWorkspace, deleteSampleWorkspace } from "@/src/lib/sample-workspace";
import { safeEqual } from "@/src/lib/secrets";

export const dynamic = "force-dynamic";

/**
 * Operator-only: creates (POST) or deletes (DELETE) the sample workspace with test logins.
 * Needs `Authorization: Bearer $CRON_SECRET`, so only someone with the server's secret
 * can call it; run `node scripts/sample-workspace.mjs` from the host's console. The
 * passwords are returned once in the response and never logged.
 */
function authorize(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";

  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}

export async function POST(request: Request) {
  const refused = authorize(request);

  if (refused) {
    return refused;
  }

  const result = await createSampleWorkspace();
  return NextResponse.json(result, { status: result.created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const refused = authorize(request);

  if (refused) {
    return refused;
  }

  return NextResponse.json({ deleted: await deleteSampleWorkspace() });
}
