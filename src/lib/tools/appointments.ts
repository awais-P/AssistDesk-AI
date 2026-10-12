import { createNotification } from "../notifications";
import { prisma } from "../prisma";
import { safeTimeZone } from "../analytics-math";
import {
  clampSlotMinutes,
  computeFreeSlots,
  formatSlot,
  isBookableSlot,
  parseAppointmentHours,
} from "./appointments-math";

/** Module 2 FE-1: appointment settings, availability and booking for a workspace. */

export async function loadAppointmentSettings(workspaceId: string) {
  const settings = await prisma.workspaceSetting.findUnique({
    where: { workspaceId },
    select: { timezone: true, appointmentSlotMinutes: true, appointmentHours: true, appointmentDaysAhead: true },
  });

  return {
    timeZone: safeTimeZone(settings?.timezone ?? "UTC"),
    slotMinutes: clampSlotMinutes(settings?.appointmentSlotMinutes ?? 30),
    hours: parseAppointmentHours(settings?.appointmentHours ?? null),
    daysAhead: Math.min(60, Math.max(1, settings?.appointmentDaysAhead ?? 14)),
  };
}

async function bookedBetween(workspaceId: string, from: Date, to: Date) {
  const rows = await prisma.appointment.findMany({
    where: { workspaceId, status: "BOOKED", startsAt: { gte: new Date(from.getTime() - 24 * 60 * 60_000), lte: to } },
    select: { startsAt: true, durationMinutes: true },
  });
  return rows;
}

/** Free slots; the AI gets a short list (8), the dashboard can ask for a whole day. */
export async function findFreeSlots(workspaceId: string, date: string | null, now = new Date(), limit = 8) {
  const settings = await loadAppointmentSettings(workspaceId);
  const until = new Date(now.getTime() + settings.daysAhead * 24 * 60 * 60_000);
  const booked = await bookedBetween(workspaceId, now, until);

  return {
    ...settings,
    slots: computeFreeSlots({ ...settings, now, booked, date, limit }),
  };
}

export type BookingInput = {
  workspaceId: string;
  startsAt: Date;
  name: string;
  email: string | null;
  phone: string | null;
  topic: string | null;
  contactId: string | null;
  sessionId: string | null;
  createdBy: "AI" | "TEAM";
};

/**
 * Books a slot after re-checking it is still free inside a serializable transaction,
 * so two customers can't take the same slot at the same moment.
 */
export async function bookAppointment(input: BookingInput) {
  const settings = await loadAppointmentSettings(input.workspaceId);
  const now = new Date();

  const result = await prisma.$transaction(
    async (tx) => {
      const booked = await tx.appointment.findMany({
        where: {
          workspaceId: input.workspaceId,
          status: "BOOKED",
          startsAt: {
            gte: new Date(input.startsAt.getTime() - 24 * 60 * 60_000),
            lte: new Date(input.startsAt.getTime() + 24 * 60 * 60_000),
          },
        },
        select: { startsAt: true, durationMinutes: true },
      });
      const check = isBookableSlot({ ...settings, startsAt: input.startsAt, now, booked });

      if (!check.ok) {
        return { ok: false as const, reason: check.reason };
      }

      const appointment = await tx.appointment.create({
        data: {
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          sessionId: input.sessionId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          topic: input.topic,
          startsAt: input.startsAt,
          durationMinutes: settings.slotMinutes,
          createdBy: input.createdBy,
        },
      });

      return { ok: true as const, appointment };
    },
    { isolationLevel: "Serializable" },
  );

  if (result.ok) {
    await createNotification({
      workspaceId: input.workspaceId,
      type: "APPOINTMENT_BOOKED",
      severity: "SUCCESS",
      title: `Appointment booked: ${input.name}, ${formatSlot(input.startsAt, settings.timeZone)}`,
      body: [input.topic, input.email, input.phone].filter(Boolean).join(" · ") || null,
      link: "/dashboard/appointments",
    });
  }

  return { ...result, timeZone: settings.timeZone };
}
