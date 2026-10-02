import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";

const MAX_IDS = 1000;

/**
 * Marks knowledge-gap questions as handled (e.g. after adding the answer to the
 * knowledge base), so the improvement list only shows open work. `reviewed: false`
 * puts them back. Manager role or higher (they manage the knowledge base).
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "MANAGER");

  if (forbidden) {
    return forbidden;
  }

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; reviewed?: unknown };
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.length <= 40))].slice(0, MAX_IDS)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "Choose at least one question." }, { status: 400 });
  }

  const reviewed = body.reviewed !== false;
  const result = await prisma.aiInteraction.updateMany({
    where: { id: { in: ids }, workspaceId: session.user.workspaceId },
    data: reviewed
      ? { reviewedAt: new Date(), reviewedBy: session.user.fullName }
      : { reviewedAt: null, reviewedBy: null },
  });

  return NextResponse.json({ updated: result.count, reviewed });
}
