import type { ReactNode } from "react";

/**
 * Module 4: small building blocks shared by the Analytics "Reports" and "Improve"
 * pages — formatting helpers, panels, stat tiles and plain CSS bar lists.
 * Colours follow the dataviz method: one blue series hue, a one-hue ordinal ramp
 * for ordered stages, a one-hue sequential ramp for magnitude (dark surface: the
 * darkest step means "few", the lightest "many") and a reserved status palette that
 * always travels with an icon and a label.
 */

/** Single-series bar hue (categorical slot 1, dark step; 5.4:1 on #0a0a0a). */
export const SERIES_COLOR = "#3987e5";

/** Ordinal ramp (validated: monotone, visible steps, darkest end ≥ 2:1 on the surface). */
export const ORDINAL_RAMP = ["#1c5cab", "#2a78d6", "#5598e7", "#86b6ef"] as const;

/** Sequential ramp for the activity heatmap, few → many on the dark surface. */
export const SEQUENTIAL_RAMP = ["#0d366b", "#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"] as const;

/** Reserved status colours (never used for a series). */
export const STATUS_COLORS = { good: "#0ca30c", warning: "#fab219", critical: "#d03b3b" } as const;

export const channelLabels: Record<string, string> = {
  WEB_WIDGET: "Website",
  WHATSAPP: "WhatsApp",
  SLACK: "Slack",
  EMAIL: "Email",
  VOICE: "Voice",
};

export const CHANNEL_ORDER = ["WEB_WIDGET", "WHATSAPP", "SLACK", "EMAIL"];

export function channelLabel(value: string) {
  return channelLabels[value] ?? formatEnum(value);
}

export function formatEnum(value: string) {
  const text = value.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

export function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

/** 252 → "4m 12s", 3725 → "1h 2m", 42 → "42s". */
export function formatSeconds(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) {
    return "—";
  }

  const total = Math.max(0, Math.round(seconds));

  if (total < 60) {
    return `${total}s`;
  }

  const minutes = Math.floor(total / 60);

  if (minutes < 60) {
    return `${minutes}m ${total % 60}s`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }

  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatHour(hour: number) {
  return `${String(hour % 24).padStart(2, "0")}:00`;
}

/** 14 → "14:00–15:00". */
export function formatHourRange(hour: number) {
  return `${formatHour(hour)}–${formatHour(hour + 1)}`;
}

/** Absolute date + time in the workspace time zone (stable between server and browser). */
export function formatDateTime(iso: string | null | undefined, timeZone: string) {
  if (!iso) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

/** Record entries, in a fixed order when given (unknown keys last), else largest first. */
export function orderedEntries(record: Record<string, number>, order?: readonly string[]) {
  const entries = Object.entries(record).filter(([, value]) => value > 0);

  if (!order) {
    return entries.sort((a, b) => b[1] - a[1]);
  }

  const rank = (key: string) => {
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };

  return entries.sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1]);
}

export async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

export function Panel({
  title,
  description,
  action,
  children,
  id,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id={id ? `${id}-title` : undefined} className="text-base font-semibold text-white">
            {title}
          </h3>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0 text-sm">{action}</div> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function StatTile({ label, value, detail }: { label: string; value: string; detail?: ReactNode }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-3 text-[2rem] font-semibold leading-none text-white">{value}</p>
      {detail ? <p className="mt-3 text-sm text-slate-500">{detail}</p> : null}
    </div>
  );
}

export type BarItem = { key: string; label: string; value: number; hint?: string; color?: string };

/**
 * Horizontal bars from one baseline, value + share at the end of each label row.
 * Bars are 8px thick with a rounded data end and a square baseline end.
 */
export function BarList({
  items,
  emptyText,
  total: totalOverride,
}: {
  items: BarItem[];
  emptyText: string;
  /** Denominator for the share; defaults to the sum of the items. */
  total?: number;
}) {
  const nonEmpty = items.filter((item) => item.value > 0);

  if (nonEmpty.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">{emptyText}</p>;
  }

  const max = Math.max(...nonEmpty.map((item) => item.value));
  const total = totalOverride ?? nonEmpty.reduce((sum, item) => sum + item.value, 0);

  return (
    <ul className="space-y-3">
      {nonEmpty.map((item) => (
        <li key={item.key}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-slate-200">{item.label}</span>
            <span className="shrink-0 tabular-nums text-slate-400">
              {formatNumber(item.value)}
              {item.hint ? ` · ${item.hint}` : total > 0 ? ` · ${Math.round((item.value / total) * 100)}%` : ""}
            </span>
          </div>
          <div className="mt-1.5 h-2 rounded-r-[4px] bg-white/[0.05]" role="presentation">
            <div
              className="h-2 rounded-r-[4px]"
              style={{ width: `${Math.max(1.5, (item.value / max) * 100)}%`, backgroundColor: item.color ?? SERIES_COLOR }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ChannelChips({ channels }: { channels: Record<string, number> }) {
  const entries = orderedEntries(channels, CHANNEL_ORDER);

  if (entries.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Channels">
      {entries.map(([channel, count]) => (
        <li
          key={channel}
          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs text-slate-300"
        >
          {channelLabel(channel)}
          <span className="tabular-nums text-slate-500">{formatNumber(count)}</span>
        </li>
      ))}
    </ul>
  );
}

type AnswerLevel = "good" | "warning" | "critical";

export function answerLevel(rate: number | null): AnswerLevel | null {
  if (rate === null) {
    return null;
  }

  return rate >= 0.8 ? "good" : rate >= 0.5 ? "warning" : "critical";
}

const levelText: Record<AnswerLevel, string> = { good: "Well covered", warning: "Partly covered", critical: "Needs an answer" };

/** "Answered from knowledge" rate: status colour + icon + label, never colour alone. */
export function AnsweredBadge({ rate }: { rate: number | null }) {
  const level = answerLevel(rate);

  if (!level) {
    return <span className="text-sm text-slate-500">—</span>;
  }

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <StatusIcon level={level} />
      <span className="font-semibold tabular-nums text-white">{formatPercent(rate)}</span>
      <span className="text-slate-400">{levelText[level]}</span>
    </span>
  );
}

export function StatusIcon({ level }: { level: AnswerLevel }) {
  const color = STATUS_COLORS[level];

  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill={color} />
      {level === "good" ? (
        <path d="M4.8 8.2 7 10.3l4.2-4.6" fill="none" stroke="#0a0a0a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : level === "warning" ? (
        <path d="M8 4.4v4.4M8 11.2v.4" fill="none" stroke="#0a0a0a" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="m5.4 5.4 5.2 5.2m0-5.2-5.2 5.2" fill="none" stroke="#0a0a0a" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center px-6 py-10 text-center">
      {icon ?? (
        <svg viewBox="0 0 24 24" className="h-10 w-10 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 20V10" />
          <path d="M10 20V4" />
          <path d="M16 20v-7" />
          <path d="M22 20H2" />
        </svg>
      )}
      <p className="mt-4 text-lg text-slate-300">{title}</p>
      {children ? <div className="mt-2 max-w-md text-sm text-slate-500">{children}</div> : null}
    </div>
  );
}

export const secondaryButtonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3.5 text-sm font-medium text-white transition hover:bg-[#191919] disabled:cursor-not-allowed disabled:opacity-50";

export const primaryButtonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg bg-white px-3.5 text-sm font-semibold text-[#050505] transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-neutral-400";

export const textLinkClass = "text-slate-300 underline underline-offset-2 transition hover:text-white";
