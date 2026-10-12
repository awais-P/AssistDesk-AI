/**
 * Module 2 FE-1 appointment booking: business hours, free slots and slot checks in the
 * workspace time zone. Pure functions, unit-tested.
 */

export type AppointmentHours = {
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  days: number[];
  start: string;
  end: string;
};

export const DEFAULT_APPOINTMENT_HOURS: AppointmentHours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
export const MIN_LEAD_MINUTES = 60;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOf(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function parseAppointmentHours(raw: unknown): AppointmentHours {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const days = Array.isArray(value.days)
    ? [...new Set(value.days.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort()
    : DEFAULT_APPOINTMENT_HOURS.days;
  const start = typeof value.start === "string" && TIME.test(value.start) ? value.start : DEFAULT_APPOINTMENT_HOURS.start;
  const end = typeof value.end === "string" && TIME.test(value.end) ? value.end : DEFAULT_APPOINTMENT_HOURS.end;

  return minutesOf(end) > minutesOf(start)
    ? { days: days.length ? days : DEFAULT_APPOINTMENT_HOURS.days, start, end }
    : DEFAULT_APPOINTMENT_HOURS;
}

export function clampSlotMinutes(value: unknown) {
  const minutes = Number(value);
  return [15, 20, 30, 45, 60, 90, 120].includes(minutes) ? minutes : 30;
}

/** Calendar parts of an instant in a time zone. */
function localParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    isoWeekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1,
  };
}

/** The UTC instant of a wall-clock time in a time zone (handles DST by re-checking). */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;

  for (let index = 0; index < 3; index += 1) {
    const parts = localParts(new Date(guess), timeZone);
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const diff = target - shown;

    if (diff === 0) {
      break;
    }

    guess += diff;
  }

  return new Date(guess);
}

export function formatSlot(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export type BookedSlot = { startsAt: Date; durationMinutes: number };

function overlaps(start: number, minutes: number, booked: BookedSlot[]) {
  const end = start + minutes * 60_000;
  return booked.some((item) => {
    const bookedStart = item.startsAt.getTime();
    const bookedEnd = bookedStart + item.durationMinutes * 60_000;
    return start < bookedEnd && end > bookedStart;
  });
}

/**
 * Free slots from `now`, in business hours, not overlapping existing bookings, at
 * least MIN_LEAD_MINUTES ahead. `date` (YYYY-MM-DD, workspace time zone) limits the
 * search to that day.
 */
export function computeFreeSlots({
  hours,
  slotMinutes,
  timeZone,
  now,
  daysAhead,
  booked,
  date = null,
  limit = 8,
}: {
  hours: AppointmentHours;
  slotMinutes: number;
  timeZone: string;
  now: Date;
  daysAhead: number;
  booked: BookedSlot[];
  date?: string | null;
  limit?: number;
}) {
  const slots: Array<{ startsAt: string; label: string }> = [];
  const earliest = now.getTime() + MIN_LEAD_MINUTES * 60_000;
  const today = localParts(now, timeZone);
  const startMinutes = minutesOf(hours.start);
  const endMinutes = minutesOf(hours.end);
  const requested = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split("-").map(Number) : null;

  for (let offset = 0; offset <= Math.min(60, daysAhead) && slots.length < limit; offset += 1) {
    // Noon UTC of the local date avoids DST edges when stepping days.
    const dayInstant = new Date(Date.UTC(today.year, today.month - 1, today.day + offset, 12));
    const dayYear = dayInstant.getUTCFullYear();
    const dayMonth = dayInstant.getUTCMonth() + 1;
    const dayDate = dayInstant.getUTCDate();

    if (requested && (requested[0] !== dayYear || requested[1] !== dayMonth || requested[2] !== dayDate)) {
      continue;
    }

    const weekday = ((dayInstant.getUTCDay() + 6) % 7) + 1;

    if (!hours.days.includes(weekday)) {
      continue;
    }

    for (let minute = startMinutes; minute + slotMinutes <= endMinutes && slots.length < limit; minute += slotMinutes) {
      const start = zonedTimeToUtc(dayYear, dayMonth, dayDate, Math.floor(minute / 60), minute % 60, timeZone);

      if (start.getTime() < earliest || overlaps(start.getTime(), slotMinutes, booked)) {
        continue;
      }

      slots.push({ startsAt: start.toISOString(), label: formatSlot(start, timeZone) });
    }
  }

  return slots;
}

/** Whether `startsAt` is a bookable slot right now (business hours, alignment, free). */
export function isBookableSlot({
  startsAt,
  hours,
  slotMinutes,
  timeZone,
  now,
  daysAhead,
  booked,
}: {
  startsAt: Date;
  hours: AppointmentHours;
  slotMinutes: number;
  timeZone: string;
  now: Date;
  daysAhead: number;
  booked: BookedSlot[];
}) {
  if (Number.isNaN(startsAt.getTime())) {
    return { ok: false as const, reason: "That is not a valid date and time." };
  }

  if (startsAt.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) {
    return { ok: false as const, reason: `Appointments must be at least ${MIN_LEAD_MINUTES} minutes from now.` };
  }

  if (startsAt.getTime() > now.getTime() + daysAhead * 24 * 60 * 60_000) {
    return { ok: false as const, reason: `Appointments can be booked up to ${daysAhead} days ahead.` };
  }

  const parts = localParts(startsAt, timeZone);
  const minute = parts.hour * 60 + parts.minute;

  if (!hours.days.includes(parts.isoWeekday) || minute < minutesOf(hours.start) || minute + slotMinutes > minutesOf(hours.end)) {
    return { ok: false as const, reason: "That time is outside business hours." };
  }

  if ((minute - minutesOf(hours.start)) % slotMinutes !== 0) {
    return { ok: false as const, reason: "Please choose one of the offered slots." };
  }

  if (overlaps(startsAt.getTime(), slotMinutes, booked)) {
    return { ok: false as const, reason: "That slot was just taken." };
  }

  return { ok: true as const };
}
