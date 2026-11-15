"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { channelBadgeClass, channelLabels, labelFrom } from "@/src/lib/contact-labels";
import type { EscalationView, SerializedEscalation, computeEscalationStats } from "@/src/lib/escalation-queries";
import { RelativeTime } from "./notifications-bell";

type Stats = ReturnType<typeof computeEscalationStats>;
type Member = { id: string; fullName: string; role: string };
type ListResponse = { items: SerializedEscalation[]; stats: Stats; members: Member[]; me: { id: string; role: string; canExport: boolean; canAssign: boolean }; error?: string };

const REFRESH_MS = 15_000;

const views: Array<{ value: EscalationView; label: string }> = [
  { value: "queue", label: "Queue" },
  { value: "mine", label: "Mine" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

const outcomeOptions = [
  { value: "HANDED_BACK", label: "Hand back to the AI", help: "The AI answers this customer again." },
  { value: "CLOSED", label: "Close the conversation", help: "Ends the chat; their next message starts a new one with the same context." },
  { value: "RESOLVED", label: "Resolved, keep with the team", help: "The conversation stays with people; the AI stays paused here." },
] as const;

const resolutionLabels: Record<string, string> = {
  HANDED_BACK: "Handed back to the AI",
  CLOSED: "Conversation closed",
  RESOLVED: "Resolved by the team",
};

const secondaryButtonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3.5 text-sm font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-50";
const primaryButtonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg bg-white px-3.5 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-50";
const selectClass =
  "h-9 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white outline-none transition focus:border-white disabled:opacity-60";

const triggerNames: Record<string, string> = {
  SENTIMENT: "Negative sentiment",
  HUMAN_REQUEST: "Asked for a person",
  KEYWORD: "Sensitive topic",
  CUSTOMER_FLAGGED: "Kept with the team",
  AI_TOOL: "AI handed over",
  TOOL_FAILURE: "Action failed",
  MANUAL: "Taken over",
};

function priorityBadgeClass(priority: string) {
  const base = "inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide";
  if (priority === "URGENT") return `${base} border-red-500/40 bg-red-500/15 text-red-200`;
  if (priority === "HIGH") return `${base} border-orange-500/40 bg-orange-500/10 text-orange-200`;
  if (priority === "MEDIUM") return `${base} border-amber-500/30 bg-amber-500/10 text-amber-100`;
  return `${base} border-white/10 bg-white/5 text-slate-300`;
}

function statusBadgeClass(status: string) {
  const base = "inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-medium";
  if (status === "PENDING") return `${base} border-amber-500/30 bg-amber-500/10 text-amber-100`;
  if (status === "ACCEPTED") return `${base} border-sky-500/30 bg-sky-500/10 text-sky-200`;
  return `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-200`;
}

function moodText(score: number | null) {
  if (score === null) return null;
  if (score <= -0.75) return "Very upset";
  if (score <= -0.4) return "Frustrated";
  if (score < -0.1) return "Unhappy";
  if (score >= 0.4) return "Positive";
  return "Calm";
}

function minutesUntil(iso: string, now: number) {
  return Math.round((new Date(iso).getTime() - now) / 60_000);
}

function StatTile({ label, value, hint, tone = "default" }: { label: string; value: string; hint?: string; tone?: "default" | "warn" }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone === "warn" ? "border-red-500/30 bg-red-500/10" : "border-white/10 bg-[#0a0a0a]"}`}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function EscalationsWorkspace({ initialView, focusId }: { initialView: EscalationView; focusId: string | null }) {
  const [view, setView] = useState<EscalationView>(initialView);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string>("HANDED_BACK");
  const [note, setNote] = useState("");
  const [keepWithTeam, setKeepWithTeam] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const focused = useRef(false);

  const load = useCallback(async (target: EscalationView) => {
    try {
      const response = await fetch(`/api/escalations?view=${target}`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as ListResponse;
      if (!response.ok) {
        setError(body.error ?? "Could not load escalations.");
        return;
      }
      setError("");
      setData(body);
      setNow(Date.now());
    } catch {
      setError("Could not reach the server. Retrying...");
    }
  }, []);

  useEffect(() => {
    void load(view);
    const timer = window.setInterval(() => void load(view), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [view, load]);

  useEffect(() => {
    if (!focusId || focused.current || !data) return;
    const element = document.getElementById(`escalation-${focusId}`);
    if (element) {
      focused.current = true;
      element.scrollIntoView({ block: "center" });
    } else if (view !== "all") {
      setView("all");
    }
  }, [data, focusId, view]);

  async function act(id: string, payload: Record<string, unknown>, success: string) {
    setBusyId(id);
    setNotice("");
    setError("");
    try {
      const response = await fetch(`/api/escalations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "That did not work. Try again.");
        return false;
      }
      setNotice(success);
      await load(view);
      return true;
    } finally {
      setBusyId(null);
    }
  }

  const stats = data?.stats;
  const me = data?.me;
  // Module 11: assigning and taking over follow the user's permissions (custom roles).
  const isManager = me?.canAssign ?? false;
  const items = data?.items ?? [];

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">Escalations</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-400">
            Conversations the AI handed to your team: the customer asked for a person, was upset, raised a sensitive topic, or an
            action failed. Accept one to take over; each has an AI-written brief so you don&apos;t have to ask the customer again.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link href="/dashboard/escalations/settings" className={secondaryButtonClass}>
            Settings
          </Link>
          {me?.canExport ? (
            <a href={`/api/escalations?view=${view}&format=csv`} download className={secondaryButtonClass}>
              Export CSV
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Waiting" value={String(stats?.pending ?? "-")} hint="In the queue" />
        <StatTile label="In progress" value={String(stats?.inProgress ?? "-")} hint="Accepted by the team" />
        <StatTile label="Overdue" value={String(stats?.overdue ?? "-")} hint="Past the response time" tone={stats?.overdue ? "warn" : "default"} />
        <StatTile
          label="Time to accept"
          value={stats?.averageAcceptMinutes === null || stats === undefined ? "-" : `${stats.averageAcceptMinutes} min`}
          hint="Average, last 30 days"
        />
        <StatTile label="Within SLA" value={stats?.slaMetPercent === null || stats === undefined ? "-" : `${stats.slaMetPercent}%`} hint="Accepted in time, 30 days" />
      </div>

      {stats && stats.total > 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          <span className="text-slate-300">Why customers reached the team (30 days): </span>
          {Object.entries(stats.byTrigger)
            .sort((a, b) => b[1] - a[1])
            .map(([trigger, count]) => `${triggerNames[trigger] ?? trigger} ${count}`)
            .join(" · ")}
        </p>
      ) : null}

      <nav aria-label="Escalation views" className="mt-6 flex flex-wrap gap-2">
        {views.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={view === tab.value}
            onClick={() => {
              setView(tab.value);
              setResolvingId(null);
            }}
            className={`h-9 rounded-lg border px-3.5 text-sm font-medium transition ${
              view === tab.value ? "border-white bg-white text-black" : "border-white/10 bg-[#111111] text-white hover:bg-[#191919]"
            }`}
          >
            {tab.label}
            {tab.value === "queue" && stats ? ` (${stats.pending})` : ""}
          </button>
        ))}
      </nav>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 space-y-3" aria-busy={!data}>
        {data && items.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[22px] border border-white/10 bg-[#0a0a0a] px-6 py-14 text-center">
            <p className="text-xl text-slate-300">{view === "queue" ? "No one is waiting for a person" : "Nothing here yet"}</p>
            <p className="mt-2 max-w-lg text-sm text-slate-500">
              When a customer asks for a person, is upset, or mentions something sensitive, the conversation appears here and the team is
              alerted. Tune the triggers in Settings.
            </p>
          </div>
        ) : null}

        {items.map((item) => {
          const mine = item.assignee?.id === me?.id;
          const open = item.status !== "RESOLVED";
          const dueIn = item.slaDueAt && item.status === "PENDING" ? minutesUntil(item.slaDueAt, now) : null;
          const mood = moodText(item.sentimentScore);
          const isBusy = busyId === item.id;

          return (
            <article
              key={item.id}
              id={`escalation-${item.id}`}
              className={`rounded-[22px] border bg-[#0a0a0a] p-5 ${focusId === item.id ? "border-white/60" : item.slaBreached && open ? "border-red-500/40" : "border-white/10"}`}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={priorityBadgeClass(item.priority)}>{item.priority}</span>
                    <span className={statusBadgeClass(item.status)}>
                      {item.status === "PENDING" ? "Waiting" : item.status === "ACCEPTED" ? "In progress" : "Resolved"}
                    </span>
                    <span className={channelBadgeClass(item.channel)}>{labelFrom(channelLabels, item.channel)}</span>
                    <span className="text-xs text-slate-400">{item.triggerLabel}</span>
                    {mood ? <span className="text-xs text-slate-500">· {mood}</span> : null}
                  </div>
                  <h2 className="mt-2 truncate text-lg font-semibold text-white">
                    {item.customer}
                    {item.ticket ? <span className="ml-2 text-sm font-normal text-slate-400">{item.ticket.number} · {item.ticket.subject}</span> : null}
                  </h2>
                  <p className="mt-1 text-sm text-slate-300">{item.reason}</p>
                </div>

                <div className="shrink-0 text-sm text-slate-400 lg:text-right">
                  <p>
                    Raised <RelativeTime value={item.createdAt} />
                  </p>
                  {dueIn !== null ? (
                    <p className={dueIn < 0 ? "font-semibold text-red-300" : dueIn <= 5 ? "text-amber-200" : ""}>
                      {dueIn < 0 ? `Overdue by ${Math.abs(dueIn)} min` : `Accept within ${dueIn} min`}
                    </p>
                  ) : null}
                  {item.assignee && open ? <p>{mine ? "You are handling this" : `${item.assignee.fullName} is handling this`}</p> : null}
                  {item.assignee && !open ? <p>Handled by {mine ? "you" : item.assignee.fullName}</p> : null}
                  {!item.assignee && open ? <p>Unassigned</p> : null}
                  {item.resolution ? (
                    <p>
                      {resolutionLabels[item.resolution] ?? item.resolution}
                      {item.resolvedBy ? ` by ${item.resolvedBy.fullName}` : ""}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/40 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Hand-over brief</p>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void act(item.id, { action: "summarize" }, "The brief was written again.")}
                    className="text-xs text-slate-400 underline underline-offset-2 hover:text-white disabled:opacity-50"
                  >
                    Rewrite
                  </button>
                </div>
                {item.summary ? (
                  <p className="mt-2 whitespace-pre-line text-sm text-slate-200">{item.summary}</p>
                ) : (
                  <p className="mt-2 text-sm italic text-slate-500">The AI is writing the brief...</p>
                )}
                {item.resolutionNote ? <p className="mt-2 text-sm text-slate-400">Note: {item.resolutionNote}</p> : null}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                {item.link ? (
                  <Link href={item.link} className={secondaryButtonClass}>
                    {item.session ? "Open conversation" : "Open ticket"}
                  </Link>
                ) : null}
                {item.status === "PENDING" ? (
                  <button type="button" disabled={isBusy} className={primaryButtonClass} onClick={() => void act(item.id, { action: "accept" }, "You accepted the escalation. The customer was told you joined.")}>
                    Accept
                  </button>
                ) : null}
                {item.status === "ACCEPTED" && !mine && isManager ? (
                  <button type="button" disabled={isBusy} className={secondaryButtonClass} onClick={() => void act(item.id, { action: "accept", force: true }, "You took over this escalation.")}>
                    Take over
                  </button>
                ) : null}
                {open && isManager ? (
                  <>
                    <label htmlFor={`assign-${item.id}`} className="sr-only">
                      Assign to
                    </label>
                    <select
                      id={`assign-${item.id}`}
                      value=""
                      disabled={isBusy}
                      onChange={(event) => {
                        const member = data?.members.find((entry) => entry.id === event.target.value);
                        if (member) void act(item.id, { action: "assign", assigneeId: member.id }, `Assigned to ${member.fullName}.`);
                      }}
                      className={selectClass}
                    >
                      <option value="">Assign to...</option>
                      {data?.members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.fullName}
                          {member.id === me?.id ? " (you)" : ""}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}
                {open && (mine || isManager || !item.assignee) ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    className={secondaryButtonClass}
                    onClick={() => {
                      setResolvingId(resolvingId === item.id ? null : item.id);
                      setOutcome(item.session ? "HANDED_BACK" : "RESOLVED");
                      setNote("");
                      setKeepWithTeam(false);
                    }}
                  >
                    Resolve
                  </button>
                ) : null}
              </div>

              {resolvingId === item.id ? (
                <form
                  className="mt-4 space-y-3 rounded-xl border border-white/10 bg-[#111111] p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(item.id, { action: "resolve", outcome, note, keepWithTeam }, "Escalation resolved.").then((done) => {
                      if (done) setResolvingId(null);
                    });
                  }}
                >
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-semibold text-white">How did it end?</legend>
                    {outcomeOptions
                      .filter((option) => item.session || option.value === "RESOLVED")
                      .map((option) => (
                        <label key={option.value} className="flex items-start gap-2.5 text-sm text-slate-200">
                          <input
                            type="radio"
                            name={`outcome-${item.id}`}
                            value={option.value}
                            checked={outcome === option.value}
                            onChange={() => {
                              setOutcome(option.value);
                              if (option.value === "HANDED_BACK") setKeepWithTeam(false);
                            }}
                            className="mt-1"
                          />
                          <span>
                            {option.label}
                            <span className="block text-xs text-slate-500">{option.help}</span>
                          </span>
                        </label>
                      ))}
                  </fieldset>
                  {item.contact ? (
                    <label className="flex items-start gap-2.5 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={keepWithTeam}
                        disabled={outcome === "HANDED_BACK"}
                        onChange={(event) => setKeepWithTeam(event.target.checked)}
                        className="mt-1"
                      />
                      <span>
                        Keep this customer with the team
                        <span className="block text-xs text-slate-500">Their future conversations go straight to a person, on every channel.</span>
                      </span>
                    </label>
                  ) : null}
                  <label className="block text-sm text-slate-200">
                    Note for the record (optional)
                    <textarea
                      value={note}
                      maxLength={1000}
                      onChange={(event) => setNote(event.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-white outline-none focus:border-white"
                    />
                  </label>
                  <div className="flex gap-2.5">
                    <button type="submit" disabled={isBusy} className={primaryButtonClass}>
                      Resolve escalation
                    </button>
                    <button type="button" className={secondaryButtonClass} onClick={() => setResolvingId(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
