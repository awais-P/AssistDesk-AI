import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { countOnlineOperators, touchUserPresence } from "@/src/lib/presence";

/** Dashboard heartbeat: marks the signed-in team member as online. */
export async function POST() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await touchUserPresence(session.user.id);

  return NextResponse.json({
    online: true,
    operatorsOnline: await countOnlineOperators(session.user.workspaceId),
  });
}
