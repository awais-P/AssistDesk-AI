import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { getCurrentSession } from "@/src/lib/auth";
import { normalizeEmail, normalizePhone } from "@/src/lib/identity";
import { prisma } from "@/src/lib/prisma";
import { hasRole } from "@/src/lib/rbac";
import { bookAppointment, findFreeSlots, loadAppointmentSettings } from "@/src/lib/tools/appointments";
import { formatSlot } from "@/src/lib/tools/appointments-math";

/** Module 2 FE-1: appointments booked by the AI (book_appointment) or by the team. */

const PAGE_SIZE = 25;
const VIEWS = ["upcoming", "past", "cancelled", "all"] as const;
type View = (typeof VIEWS)[number];

function serializeAppointment(
  row: Prisma.AppointmentGetPayload<{ include: { contact: { select: { id: true; name: true } } } }>,
  timeZone: string,
) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    topic: row.topic,
    notes: row.notes,
    status: row.status,
    createdBy: row.createdBy,
    startsAt: row.startsAt.toISOString(),
    label: formatSlot(row.startsAt, timeZone),
    durationMinutes: row.durationMinutes,
    sessionId: row.sessionId,
    contact: row.contact,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const url = new URL(request.url);
  const view: View = (VIEWS as readonly string[]).includes(url.searchParams.get("view") ?? "") ? (url.searchParams.get("view") as View) : "upcoming";
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
  const search = url.searchParams.get("q")?.trim().slice(0, 80) ?? "";
  const now = new Date();

  const where: Prisma.AppointmentWhereInput = { workspaceId };

  if (view === "upcoming") {
    where.status = "BOOKED";
    where.startsAt = { gte: new Date(now.getTime() - 60 * 60_000) };
  } else if (view === "past") {
    where.status = { in: ["BOOKED", "COMPLETED"] };
    where.startsAt = { lt: new Date(now.getTime() - 60 * 60_000) };
  } else if (view === "cancelled") {
    where.status = "CANCELLED";
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { topic: { contains: search, mode: "insensitive" } },
    ];
  }

  const [settings, total, rows, upcomingCount, availability] = await Promise.all([
    loadAppointmentSettings(workspaceId),
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      include: { contact: { select: { id: true, name: true } } },
      orderBy: { startsAt: view === "upcoming" ? "asc" : "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.appointment.count({ where: { workspaceId, status: "BOOKED", startsAt: { gte: now } } }),
    findFreeSlots(workspaceId, null, now),
  ]);

  return NextResponse.json({
    appointments: rows.map((row) => serializeAppointment(row, settings.timeZone)),
    total,
    page,
    pageSize: PAGE_SIZE,
    view,
    upcomingCount,
    settings,
    nextFreeSlots: availability.slots,
    canEditSettings: hasRole(session.user.role, "ADMIN"),
  });
}

type BookingPayload = { startsAt?: unknown; name?: unknown; email?: unknown; phone?: unknown; topic?: unknown };

/** A team member books a slot for a customer (same checks as the AI's booking). */
export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as BookingPayload;
  const startsAt = typeof body.startsAt === "string" ? new Date(body.startsAt) : null;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const email = typeof body.email === "string" && body.email.trim() ? normalizeEmail(body.email) : null;
  const phone = typeof body.phone === "string" && body.phone.trim() ? normalizePhone(body.phone) : null;
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) || null : null;

  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    return NextResponse.json({ error: "Choose a time slot." }, { status: 400 });
  }

  if (!name) {
    return NextResponse.json({ error: "Enter the customer's name." }, { status: 400 });
  }

  if (typeof body.email === "string" && body.email.trim() && !email) {
    return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  }

  if (!email && !phone) {
    return NextResponse.json({ error: "Add an email or phone number so the customer can be reached." }, { status: 400 });
  }

  const workspaceId = session.user.workspaceId;
  const contact = email || phone
    ? await prisma.contact.findFirst({
        where: { workspaceId, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
        select: { id: true },
      })
    : null;
  const result = await bookAppointment({
    workspaceId,
    startsAt,
    name,
    email,
    phone,
    topic,
    contactId: contact?.id ?? null,
    sessionId: null,
    createdBy: "TEAM",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }

  const row = await prisma.appointment.findUniqueOrThrow({ where: { id: result.appointment.id }, include: { contact: { select: { id: true, name: true } } } });
  return NextResponse.json({ appointment: serializeAppointment(row, result.timeZone) }, { status: 201 });
}
