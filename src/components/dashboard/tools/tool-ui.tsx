"use client";

import type { ReactNode } from "react";

/** Small shared pieces for the Module 2 screens (tools, agent actions, appointments, action logs). */

export type Notice = { tone: "success" | "error"; text: string } | null;

export const inputClass =
  "h-11 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-white disabled:cursor-not-allowed disabled:text-slate-500";

export const textareaClass =
  "w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-white disabled:cursor-not-allowed disabled:text-slate-500";

export const primaryButtonClass =
  "pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-400";

export const secondaryButtonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3 text-xs font-semibold text-white transition hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-60";

export const dangerButtonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60";

export function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) {
    return null;
  }

  return (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-sm ${
        notice.tone === "error"
          ? "border-red-500/30 bg-red-500/10 text-red-200"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      }`}
    >
      {notice.text}
    </p>
  );
}

export function Card({
  title,
  description,
  action,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-base font-semibold text-white">{title}</div>
          {description ? <div className="mt-1 text-sm text-slate-400">{description}</div> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? "bg-emerald-400" : "bg-white/10"
      }`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-[#050505] transition ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

export function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="mr-1.5 h-3.5 w-3.5 animate-spin" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "read" | "write" | "warn" | "ok" | "error" | "info"; children: ReactNode }) {
  const tones = {
    neutral: "border-white/10 bg-white/[0.04] text-slate-300",
    read: "border-sky-500/30 bg-sky-500/10 text-sky-200",
    write: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    error: "border-red-500/30 bg-red-500/10 text-red-200",
    info: "border-violet-500/30 bg-violet-500/10 text-violet-200",
  } as const;

  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

/** Right-side drawer used for editors (same pattern as the agent automations drawer). */
export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  width = "max-w-[560px]",
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div inert={!open} className={`fixed inset-0 z-50 transition ${open ? "pointer-events-auto" : "pointer-events-none"}`}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition duration-300 ${open ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`absolute right-0 top-0 flex h-full w-full ${width} flex-col border-l border-white/10 bg-[#090909] shadow-[-16px_0_40px_rgba(0,0,0,0.45)] transition duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xl font-semibold text-white">{title}</p>
            {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}

export function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatLatency(ms: number | null | undefined) {
  if (ms === null || ms === undefined) {
    return "—";
  }

  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string };
}
