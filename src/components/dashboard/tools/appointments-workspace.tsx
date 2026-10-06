"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Card,
  Drawer,
  type Notice,
  NoticeBox,
  Spinner,
  dangerButtonClass,
  inputClass,
  primaryButtonClass,
  readJson,
  secondaryButtonClass,
  textareaClass,
} from "./tool-ui";

/**
 * Module 2 FE-1 appointments: what the AI booked in chat (book_appointment) and what
 * the team booked, plus the business hours the AI offers slots in.
 */

type View = "upcoming" | "past" | "cancelled" | "all";

type Appointment = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  topic: string | null;
  notes: string | null;
  status: "BOOKED" | "CANCELLED" | "COMPLETED";
  createdBy: "AI" | "TEAM";
  startsAt: string;
  label: string;
  durationMinutes: number;
  sessionId: string | null;
  contact: { id: string; name: string | null } | null;
  createdAt: string;
};

type Hours = { days: number[]; start: string; end: string };
type Settings = { timeZone: string; slotMinutes: number; hours: Hours; daysAhead: number };
type Slot = { startsAt: string; label: string };

type ListResponse = {
  appointments: Appointment[];
  total: number;
  page: number;
  pageSize: number;
  upcomingCount: number;
  settings: Settings;
  nextFreeSlots: Slot[];
  canEditSettings: boolean;
};

const views: Array<{ key: View; label: string }> = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOT_OPTIONS = [15, 20, 30, 45, 60, 90, 120];

function dayKey(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function dayHeading(iso: string, timeZone: string) {
  const key = dayKey(iso, timeZone);
  const today = dayKey(new Date().toISOString(), timeZone);
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000).toISOString(), timeZone);
  const label = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
  return key === today ? `Today · ${label}` : key === tomorrow ? `Tomorrow · ${label}` : label;
}

function timeOf(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function statusBadge(appointment: Appointment) {
  if (appointment.status === "CANCELLED") return <Badge tone="error">Cancelled</Badge>;
  if (appointment.status === "COMPLETED") return <Badge tone="ok">Completed</Badge>;
  return new Date(appointment.startsAt).getTime() < Date.now() ? <Badge tone="warn">Awaiting outcome</Badge> : <Badge tone="read">Booked</Badge>;
}

function describeHours(settings: Settings) {
  const days = settings.hours.days;
  const contiguous = days.length > 1 && days.every((day, index) => index === 0 || day === days[index - 1] + 1);
  const dayText = contiguous ? `${dayNames[days[0] - 1]}–${dayNames[days[days.length - 1] - 1]}` : days.map((day) => dayNames[day - 1]).join(", ");
  return `${dayText}, ${settings.hours.start}–${settings.hours.end}`;
}

function HoursCard({ settings, canEdit, onSaved }: { settings: Settings; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ days: settings.hours.days, start: settings.hours.start, end: settings.hours.end, slotMinutes: settings.slotMinutes, daysAhead: settings.daysAhead });
  const [notice, setNotice] = useState<Notice>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setForm({ days: settings.hours.days, start: settings.hours.start, end: settings.hours.end, slotMinutes: settings.slotMinutes, daysAhead: settings.daysAhead });
  }, [settings]);

  async function save() {
    setIsSaving(true);
    setNotice(null);
    const response = await fetch("/api/appointments/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const body = await readJson<{ settings: Settings }>(response);
    setIsSaving(false);

    if (!response.ok) {
      setNotice({ tone: "error", text: body.error ?? "Could not save the hours." });
      return;
    }

    setEditing(false);
    setNotice({ tone: "success", text: "Saved. The AI now offers slots in these hours." });
    onSaved();
  }

  return (
    <Card
      title="Booking hours"
      description={`The AI offers free slots in these hours (${settings.timeZone}).`}
      action={
        canEdit && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass}>
            Edit
          </button>
        ) : null
      }
    >
      {!editing ? (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Open</dt>
            <dd className="text-right text-white">{describeHours(settings)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Slot length</dt>
            <dd className="text-white">{settings.slotMinutes} min</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Bookable</dt>
            <dd className="text-white">up to {settings.daysAhead} days ahead</dd>
          </div>
          {!canEdit ? <p className="pt-1 text-xs text-slate-500">Admins can change these hours. The time zone is set in Settings.</p> : null}
        </dl>
      ) : (
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-slate-400">Working days</legend>
            <div className="flex flex-wrap gap-1.5">
              {dayNames.map((name, index) => {
                const day = index + 1;
                const on = form.days.includes(day);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setForm({ ...form, days: on ? form.days.filter((item) => item !== day) : [...form.days, day].sort() })}
                    className={`h-9 w-11 rounded-lg border text-xs font-semibold transition ${on ? "border-white bg-white text-[#050505]" : "border-white/10 text-slate-300 hover:border-white/30"}`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="hours-start" className="mb-1 block text-xs font-medium text-slate-400">
                From
              </label>
              <input id="hours-start" type="time" step={300} value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} className={inputClass} />
            </div>
            <div>
              <label htmlFor="hours-end" className="mb-1 block text-xs font-medium text-slate-400">
                To
              </label>
              <input id="hours-end" type="time" step={300} value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} className={inputClass} />
            </div>
            <div>
              <label htmlFor="hours-slot" className="mb-1 block text-xs font-medium text-slate-400">
                Slot length
              </label>
              <select id="hours-slot" value={form.slotMinutes} onChange={(event) => setForm({ ...form, slotMinutes: Number(event.target.value) })} className={inputClass}>
                {SLOT_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} min
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="hours-ahead" className="mb-1 block text-xs font-medium text-slate-400">
                Days ahead
              </label>
              <input id="hours-ahead" type="number" min={1} max={60} value={form.daysAhead} onChange={(event) => setForm({ ...form, daysAhead: Number(event.target.value) })} className={inputClass} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className={`${secondaryButtonClass} h-10`}>
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={isSaving} className={primaryButtonClass}>
              {isSaving ? "Saving…" : "Save hours"}
            </button>
          </div>
        </div>
      )}
      <div className="mt-3">
        <NoticeBox notice={notice} />
      </div>
    </Card>
  );
}

function BookDrawer({
  open,
  settings,
  firstFreeSlot,
  onClose,
  onBooked,
}: {
  open: boolean;
  settings: Settings;
  firstFreeSlot: string | null;
  onClose: () => void;
  onBooked: (appointment: Appointment) => void;
}) {
  const today = dayKey(new Date().toISOString(), settings.timeZone);
  const [date, setDate] = useState(today);
  const [refresh, setRefresh] = useState(0);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", topic: "" });
  const [notice, setNotice] = useState<Notice>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSlots(null);
    setSlot(null);

    void (async () => {
      const response = await fetch(`/api/appointments/slots?date=${encodeURIComponent(date)}`, { cache: "no-store" });
      const body = await readJson<{ slots: Slot[] }>(response);
      if (!cancelled) setSlots(response.ok ? body.slots : []);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, date, refresh]);

  useEffect(() => {
    if (open) {
      setForm({ name: "", email: "", phone: "", topic: "" });
      setNotice(null);
      // Start on the first day that still has a free time.
      setDate(firstFreeSlot ? dayKey(firstFreeSlot, settings.timeZone) : dayKey(new Date().toISOString(), settings.timeZone));
    }
  }, [open, firstFreeSlot, settings.timeZone]);

  async function book() {
    if (!slot) {
      setNotice({ tone: "error", text: "Choose a time." });
      return;
    }

    setIsSaving(true);
    setNotice(null);
    const response = await fetch("/api/appointments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startsAt: slot, ...form }) });
    const body = await readJson<{ appointment: Appointment }>(response);
    setIsSaving(false);

    if (!response.ok) {
      setNotice({ tone: "error", text: body.error ?? "Could not book the appointment." });
      // The slot was taken meanwhile (or is no longer valid): show what is free now.
      if (response.status === 409) setRefresh((value) => value + 1);
      return;
    }

    onBooked(body.appointment);
  }

  const maxDate = dayKey(new Date(Date.now() + settings.daysAhead * 86_400_000).toISOString(), settings.timeZone);

  return (
    <Drawer open={open} title="Book appointment" description={`Times are in ${settings.timeZone}. The same rules apply as when the AI books.`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label htmlFor="book-date" className="mb-1 block text-sm font-medium text-white">
            Day
          </label>
          <input id="book-date" type="date" min={today} max={maxDate} value={date} onChange={(event) => event.target.value && setDate(event.target.value)} className={inputClass} />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-white">Time</p>
          {slots === null ? (
            <p className="flex items-center text-xs text-slate-400">
              <Spinner /> Finding free times…
            </p>
          ) : slots.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-xs text-slate-400">No free times on this day. Try another day.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {slots.map((item) => (
                <button
                  key={item.startsAt}
                  type="button"
                  aria-pressed={slot === item.startsAt}
                  onClick={() => setSlot(item.startsAt)}
                  className={`h-9 rounded-lg border px-3 text-xs font-semibold transition ${slot === item.startsAt ? "border-white bg-white text-[#050505]" : "border-white/10 text-slate-200 hover:border-white/30"}`}
                >
                  {timeOf(item.startsAt, settings.timeZone)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor="book-name" className="mb-1 block text-xs font-medium text-slate-400">
              Customer name
            </label>
            <input id="book-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor="book-email" className="mb-1 block text-xs font-medium text-slate-400">
              Email
            </label>
            <input id="book-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor="book-phone" className="mb-1 block text-xs font-medium text-slate-400">
              Phone
            </label>
            <input id="book-phone" type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={inputClass} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="book-topic" className="mb-1 block text-xs font-medium text-slate-400">
              Topic (optional)
            </label>
            <input id="book-topic" value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} placeholder="Product demo" className={inputClass} />
          </div>
        </div>
        <NoticeBox notice={notice} />
        <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
          <button type="button" onClick={onClose} className={`${secondaryButtonClass} h-10`}>
            Cancel
          </button>
          <button type="button" onClick={() => void book()} disabled={isSaving || !slot} className={primaryButtonClass}>
            {isSaving ? "Booking…" : "Book"}
          </button>
        </div>
      </div>
    </Drawer>
  );
}

function AppointmentRow({ appointment, timeZone, onChanged }: { appointment: Appointment; timeZone: string; onChanged: (notice: Notice) => void }) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(appointment.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function patch(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    const response = await fetch(`/api/appointments/${appointment.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await readJson<{ success: boolean }>(response);
    setBusy(false);
    onChanged(response.ok ? { tone: "success", text: success } : { tone: "error", text: body.error ?? "Could not update the appointment." });
  }

  const past = new Date(appointment.startsAt).getTime() < Date.now();

  return (
    <li className="rounded-xl border border-white/10 bg-[#0d0d0d] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="w-16 shrink-0 text-center">
            <p className="text-lg font-semibold text-white">{timeOf(appointment.startsAt, timeZone)}</p>
            <p className="text-[11px] text-slate-500">{appointment.durationMinutes} min</p>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {appointment.contact ? (
                <Link href={`/dashboard/contacts/${appointment.contact.id}`} className="text-sm font-semibold text-white underline-offset-2 hover:underline">
                  {appointment.name}
                </Link>
              ) : (
                <p className="text-sm font-semibold text-white">{appointment.name}</p>
              )}
              {statusBadge(appointment)}
              <Badge tone={appointment.createdBy === "AI" ? "info" : "neutral"}>{appointment.createdBy === "AI" ? "Booked by AI" : "Booked by team"}</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-400">{[appointment.email, appointment.phone].filter(Boolean).join(" · ") || "No contact details"}</p>
            {appointment.topic ? <p className="mt-1 text-sm text-slate-300">{appointment.topic}</p> : null}
            {appointment.notes && !notesOpen ? <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-slate-300">{appointment.notes}</p> : null}
            {appointment.sessionId ? (
              <Link href={`/dashboard/chats?session=${encodeURIComponent(appointment.sessionId)}`} className="mt-2 inline-block text-xs text-slate-400 underline-offset-2 hover:text-white hover:underline">
                Open the chat it was booked in →
              </Link>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {appointment.status === "BOOKED" && past ? (
            <button type="button" disabled={busy} onClick={() => void patch({ status: "COMPLETED" }, `Marked ${appointment.name}'s appointment as completed.`)} className={secondaryButtonClass}>
              Mark completed
            </button>
          ) : null}
          {appointment.status === "COMPLETED" ? (
            <button type="button" disabled={busy} onClick={() => void patch({ status: "BOOKED" }, "Moved back to booked.")} className={secondaryButtonClass}>
              Undo completed
            </button>
          ) : null}
          <button type="button" onClick={() => setNotesOpen((value) => !value)} className={secondaryButtonClass}>
            {appointment.notes ? "Edit notes" : "Add notes"}
          </button>
          {appointment.status === "BOOKED" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Cancel ${appointment.name}'s appointment on ${appointment.label}? The slot becomes free again. Let the customer know.`)) {
                  void patch({ status: "CANCELLED" }, "Appointment cancelled. The slot is free again.");
                }
              }}
              className={dangerButtonClass}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
      {notesOpen ? (
        <div className="mt-3 space-y-2">
          <textarea aria-label="Notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} className={textareaClass} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setNotesOpen(false)} className={secondaryButtonClass}>
              Close
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setNotesOpen(false);
                void patch({ notes }, "Notes saved.");
              }}
              className={`${primaryButtonClass} h-9 text-xs`}
            >
              Save notes
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function AppointmentsWorkspace() {
  const [view, setView] = useState<View>("upcoming");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [booking, setBooking] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams({ view, page: String(page) });
    if (search) params.set("q", search);
    const response = await fetch(`/api/appointments?${params}`, { cache: "no-store" });
    const body = await readJson<ListResponse>(response);

    if (!response.ok) {
      setError(body.error ?? "Could not load appointments.");
      return;
    }

    setData(body);
  }, [view, page, search]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { heading: string; items: Appointment[] }>();
    for (const appointment of data.appointments) {
      const key = dayKey(appointment.startsAt, data.settings.timeZone);
      const group = map.get(key) ?? { heading: dayHeading(appointment.startsAt, data.settings.timeZone), items: [] };
      group.items.push(appointment);
      map.set(key, group);
    }
    return [...map.values()];
  }, [data]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="max-w-[1180px]">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="heading-font text-[2.05rem] font-bold leading-none text-white">Appointments</h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-400">
              Booked by the AI in chat (with the customer&apos;s confirmation) or by your team. Turn on the
              “Book appointment” action for an agent on its Actions tab.
            </p>
          </div>
          <button type="button" onClick={() => setBooking(true)} disabled={!data} className={primaryButtonClass}>
            Book appointment
          </button>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div role="tablist" aria-label="Appointment views" className="flex rounded-xl bg-[#1a1a1a] p-1">
                {views.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={view === item.key}
                    onClick={() => {
                      setView(item.key);
                      setPage(1);
                    }}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${view === item.key ? "bg-[#2b2b2b] text-white" : "text-slate-400 hover:text-white"}`}
                  >
                    {item.label}
                    {item.key === "upcoming" && data ? <span className="ml-1.5 text-slate-500">{data.upcomingCount}</span> : null}
                  </button>
                ))}
              </div>
              <input aria-label="Search appointments" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, topic…" className={`${inputClass} h-10 sm:w-64`} />
            </div>

            <NoticeBox notice={notice} />
            {error ? <NoticeBox notice={{ tone: "error", text: error }} /> : null}

            {!data ? (
              <p className="flex items-center text-sm text-slate-400">
                <Spinner /> Loading appointments…
              </p>
            ) : data.appointments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-400">
                {search ? `No appointments match “${search}”.` : view === "upcoming" ? "No upcoming appointments. When the AI books one in chat, it appears here." : "Nothing here yet."}
              </div>
            ) : (
              <div className="space-y-5">
                {groups.map((group) => (
                  <section key={group.heading}>
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.heading}</h2>
                    <ul className="space-y-2">
                      {group.items.map((appointment) => (
                        <AppointmentRow
                          key={`${appointment.id}-${appointment.status}-${appointment.notes ?? ""}`}
                          appointment={appointment}
                          timeZone={data.settings.timeZone}
                          onChanged={(next) => {
                            setNotice(next);
                            setReloadToken((token) => token + 1);
                          }}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            {data && pages > 1 ? (
              <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                <span>
                  Page {data.page} of {pages} · {data.total} appointments
                </span>
                <div className="flex gap-2">
                  <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className={secondaryButtonClass}>
                    Previous
                  </button>
                  <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className={secondaryButtonClass}>
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {data ? (
            <div className="space-y-5">
              <HoursCard settings={data.settings} canEdit={data.canEditSettings} onSaved={() => setReloadToken((token) => token + 1)} />
              <Card title="Next free times" description="What the AI would offer a customer now.">
                {data.nextFreeSlots.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {data.nextFreeSlots.slice(0, 6).map((slot) => (
                      <li key={slot.startsAt} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-slate-200">
                        {slot.label}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-400">No free times in the booking window.</p>
                )}
              </Card>
            </div>
          ) : null}
        </div>
      </div>

      {data ? (
        <BookDrawer
          open={booking}
          settings={data.settings}
          firstFreeSlot={data.nextFreeSlots[0]?.startsAt ?? null}
          onClose={() => setBooking(false)}
          onBooked={(appointment) => {
            setBooking(false);
            setNotice({ tone: "success", text: `Booked ${appointment.name} for ${appointment.label}.` });
            setReloadToken((token) => token + 1);
          }}
        />
      ) : null}
    </div>
  );
}
