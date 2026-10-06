import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";
import { loadAppointmentSettings } from "@/src/lib/tools/appointments";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SLOT_OPTIONS = [15, 20, 30, 45, 60, 90, 120];

/** Module 2 FE-1: business hours and slot length the AI books appointments in. */
export async function PUT(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const body = (await request.json().catch(() => ({}))) as { slotMinutes?: unknown; daysAhead?: unknown; days?: unknown; start?: unknown; end?: unknown };
  const slotMinutes = Number(body.slotMinutes);
  const daysAhead = Number(body.daysAhead);
  const days = Array.isArray(body.days) ? [...new Set(body.days.map(Number))].filter((day) => Number.isInteger(day) && day >= 1 && day <= 7).sort() : [];
  const start = typeof body.start === "string" ? body.start : "";
  const end = typeof body.end === "string" ? body.end : "";

  if (!SLOT_OPTIONS.includes(slotMinutes)) {
    return NextResponse.json({ error: `Slot length must be one of ${SLOT_OPTIONS.join(", ")} minutes.` }, { status: 400 });
  }

  if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 60) {
    return NextResponse.json({ error: "Customers can book from 1 to 60 days ahead." }, { status: 400 });
  }

  if (days.length === 0) {
    return NextResponse.json({ error: "Choose at least one working day." }, { status: 400 });
  }

  if (!TIME.test(start) || !TIME.test(end) || end <= start) {
    return NextResponse.json({ error: "Opening hours need a start and a later end time, like 09:00 to 17:00." }, { status: 400 });
  }

  const [startHours, startMinutes] = start.split(":").map(Number);
  const [endHours, endMinutes] = end.split(":").map(Number);

  if (endHours * 60 + endMinutes - (startHours * 60 + startMinutes) < slotMinutes) {
    return NextResponse.json({ error: "The opening hours are shorter than one slot." }, { status: 400 });
  }

  const hours = { days, start, end } as unknown as Prisma.InputJsonValue;
  await prisma.workspaceSetting.upsert({
    where: { workspaceId: session.user.workspaceId },
    update: { appointmentSlotMinutes: slotMinutes, appointmentDaysAhead: daysAhead, appointmentHours: hours },
    create: { workspaceId: session.user.workspaceId, appointmentSlotMinutes: slotMinutes, appointmentDaysAhead: daysAhead, appointmentHours: hours },
  });

  return NextResponse.json({ settings: await loadAppointmentSettings(session.user.workspaceId) });
}
