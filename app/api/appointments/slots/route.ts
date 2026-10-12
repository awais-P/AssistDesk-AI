import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { findFreeSlots } from "@/src/lib/tools/appointments";

/** Free slots on a day (YYYY-MM-DD, workspace time zone) for booking from the dashboard. */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const date = new URL(request.url).searchParams.get("date");

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Date must look like 2026-10-05." }, { status: 400 });
  }

  // A whole day (up to 24h of 15-minute slots) so the team can pick any free time.
  const result = await findFreeSlots(session.user.workspaceId, date, new Date(), 96);
  return NextResponse.json({ slots: result.slots, timeZone: result.timeZone, slotMinutes: result.slotMinutes });
}
