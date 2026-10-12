import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

/** FR-11.4 live sessions, polled by the dashboard (zero is returned, never hidden). */
export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const groups = await prisma.chatSession.groupBy({
    by: ["channel", "status"],
    where: { workspaceId: session.user.workspaceId, status: { in: ["ACTIVE", "ESCALATED"] } },
    _count: { _all: true },
  });
  const byChannel: Record<string, number> = {};
  let withTeam = 0;

  for (const group of groups) {
    byChannel[group.channel] = (byChannel[group.channel] ?? 0) + group._count._all;
    if (group.status === "ESCALATED") withTeam += group._count._all;
  }

  return NextResponse.json({
    liveSessions: Object.values(byChannel).reduce((total, value) => total + value, 0),
    withTeam,
    byChannel,
    at: new Date().toISOString(),
  });
}
