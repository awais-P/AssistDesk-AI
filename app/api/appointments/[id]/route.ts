import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type AppointmentRouteContext = { params: Promise<{ id: string }> };

const NEXT_STATUS: Record<string, string[]> = {
  BOOKED: ["CANCELLED", "COMPLETED"],
  CANCELLED: [],
  COMPLETED: ["BOOKED"],
};

/** Module 2 FE-1: the team cancels or completes an appointment and keeps notes on it. */
export async function PATCH(request: Request, context: AppointmentRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const appointment = await prisma.appointment.findFirst({ where: { id, workspaceId: session.user.workspaceId }, select: { id: true, status: true } });

  if (!appointment) {
    return NextResponse.json({ error: "Appointment not found in this workspace." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { status?: unknown; notes?: unknown };
  const data: { status?: string; notes?: string | null } = {};

  if (body.status !== undefined) {
    const status = typeof body.status === "string" ? body.status : "";

    if (status !== appointment.status) {
      if (!(NEXT_STATUS[appointment.status] ?? []).includes(status)) {
        return NextResponse.json(
          { error: appointment.status === "CANCELLED" ? "A cancelled appointment can't be changed. Book a new slot instead." : `An appointment can't go from ${appointment.status.toLowerCase()} to ${status.toLowerCase() || "that status"}.` },
          { status: 400 },
        );
      }

      data.status = status;
    }
  }

  if (body.notes !== undefined) {
    data.notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null;
  }

  // Conditional on the status read above, so two people can't make conflicting changes.
  const updated = await prisma.appointment.updateMany({ where: { id: appointment.id, status: appointment.status }, data });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Someone else just changed this appointment. Reload and try again." }, { status: 409 });
  }

  return NextResponse.json({ success: true, status: data.status ?? appointment.status });
}
