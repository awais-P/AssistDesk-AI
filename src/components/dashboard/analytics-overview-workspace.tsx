"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { AnalyticsDashboard } from "@/src/lib/analytics";
import { AnalyticsNav } from "./analytics-nav";
import { ChannelIcon, ChannelLabel, channelName } from "./channel-icon";
import { LegendItem, TooltipRow, TooltipTitle } from "./charts/chart-primitives";
import {
  EMPTY_VALUE,
  formatChange,
  formatDuration,
  formatMs,
  formatNumber,
  formatPercent,
  formatPoints,
  formatShare,
  msTickFormatter,
} from "./charts/format";
import { LineChart } from "./charts/line-chart";
import { CHANNEL_COLORS, CHANNEL_ORDER, SERIES_MUTED, SERIES_PRIMARY, STATUS_COLORS } from "./charts/palette";
import { StackedBarChart } from "./charts/stacked-bar-chart";
import { RelativeTime } from "./notifications-bell";

/**
 * Module 4 analytics overview (SRS FE-3, mock-up M-11): FR-11.1 response time,
 * FR-11.2 automation rate, FR-11.3 leads, FR-11.4 live sessions (polled), FR-11.5
 * 24-hour latency chart, FR-11.6/11.7 recent interactions with channel icons.
 */

type AnalyticsOverviewWorkspaceProps = {
  data: AnalyticsDashboard;
  canExport: boolean;
};

type LiveState = {
  liveSessions: number;
  withTeam: number | null;
  byChannel: Record<string, number>;
  at: string | null;
  failed: boolean;
};

const LIVE_POLL_MS = 15_000;
const EXPORT_KEYS = ["range", "from", "to", "channel"];

const PERIOD_LABELS: Record<string, string> = {
  "24h": "previous 24 hours",
  "7d": "previous 7 days",
  "30d": "previous 30 days",
  "90d": "previous 90 days",
  custom: "previous period",
};

const RANGE_LABELS: Record<string, string> = {
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
  custom: "selected period",
};

type InteractionStatus = AnalyticsDashboard["recent"][number]["status"];

const statusBadge: Record<InteractionStatus, { label: string; className: string; dot: string }> = {
  AI_RESOLVED: { label: "AI Resolved", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200", dot: "bg-emerald-400" },
  ESCALATED: { label: "Escalated", className: "border-amber-500/30 bg-amber-500/15 text-amber-200", dot: "bg-amber-400" },
  UNANSWERED: { label: "Unanswered", className: "border-white/10 bg-white/5 text-slate-300", dot: "bg-slate-400" },
  ACTIVE: { label: "Active", className: "border-sky-500/30 bg-sky-500/10 text-sky-200", dot: "bg-sky-400" },
  WITH_TEAM: { label: "With team", className: "border-amber-500/50 bg-transparent text-amber-200", dot: "bg-amber-400" },
};

const agentStatusClass: Record<string, string> = {
  ACTIVE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  DRAFT: "border-white/10 bg-white/5 text-slate-300",
  ARCHIVED: "border-amber-500/30 bg-amber-500/10 text-amber-200",
};

const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const longDayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function dayLabel(dateKey: string, long = false) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? dateKey : (long ? longDayFormatter : dayFormatter).format(date);
}

// ---------- small building blocks ----------

function Card({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="heading-font text-base font-semibold text-white">{title}</h2>
          {description ? <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ViewToggle({ showTable, onToggle, label }: { showTable: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={showTable}
      aria-label={showTable ? `Show ${label} as a chart` : `Show ${label} as a table`}
      className="pressable rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white"
    >
      {showTable ? "Chart" : "Table"}
    </button>
  );
}

function EmptyChart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-400">{children}</p>
    </div>
  );
}

function ArrowIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === "up" ? <path d="M6 10V2M2.5 5.5 6 2l3.5 3.5" /> : <path d="M6 2v8M2.5 6.5 6 10l3.5-3.5" />}
    </svg>
  );
}

/**
 * Change vs the previous period. `better` says which direction is good; the colour
 * follows direction × goodness and the arrow + text carry it without colour.
 */
function ChangeBadge({
  change,
  kind,
  better,
  period,
}: {
  change: number | null;
  kind: "relative" | "points";
  better: "up" | "down" | "neutral";
  period: string;
}) {
  if (change === null) {
    return <p className="text-xs text-slate-500">No comparison with the {period}</p>;
  }

  const rounded = kind === "relative" ? Math.round(change * 100) : Math.round(change * 1000) / 10;

  if (rounded === 0) {
    return <p className="text-xs text-slate-400">No change vs the {period}</p>;
  }

  const direction = rounded > 0 ? "up" : "down";
  const tone =
    better === "neutral" ? "text-slate-300" : direction === better ? "text-emerald-300" : "text-rose-300";
  const text = kind === "relative" ? formatChange(change) : formatPoints(change);
  const verdict = better === "neutral" ? "" : direction === better ? " (better)" : " (worse)";

  return (
    <p className={`inline-flex items-center gap-1 text-xs font-medium ${tone}`}>
      <ArrowIcon direction={direction} />
      <span>
        {text}
        <span className="sr-only">{verdict}</span>
        <span className="font-normal text-slate-500"> vs {period}</span>
      </span>
    </p>
  );
}

function PrimaryKpi({
  label,
  value,
  detail,
  footer,
  href,
  hrefLabel,
  accent,
}: {
  label: ReactNode;
  value: ReactNode;
  detail: ReactNode;
  footer?: ReactNode;
  href?: string;
  hrefLabel?: string;
  accent?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-400">{label}</p>
        {accent}
      </div>
      <p className="mt-3 text-[2.4rem] font-semibold leading-none text-white">{value}</p>
      <div className="mt-3 text-xs leading-5 text-slate-400">{detail}</div>
      <div className="mt-auto pt-3">
        {footer}
        {href ? (
          <Link href={href} className="mt-2 inline-block text-xs font-semibold text-slate-300 hover:text-white">
            {hrefLabel} <span aria-hidden="true">&rarr;</span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function SecondaryKpi({ label, value, hint, extra }: { label: string; value: string; hint: string; extra?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[18px] border border-white/10 bg-[#0a0a0a] px-4 py-3.5" title={hint}>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="mt-1.5 text-xl font-semibold leading-tight text-white">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-slate-500">{hint}</p>
      {extra ? <div className="mt-1.5">{extra}</div> : null}
    </div>
  );
}

function StatusBadge({ status }: { status: InteractionStatus }) {
  const badge = statusBadge[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badge.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} aria-hidden="true" />
      {badge.label}
    </span>
  );
}

function LiveDot({ active }: { active: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden="true">
      {active ? <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" /> : null}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${active ? "bg-emerald-400" : "bg-slate-500"}`} />
    </span>
  );
}

// ---------- FR-11.4 live sessions (polled) ----------

function useLiveSessions(initial: LiveState) {
  const [live, setLive] = useState<LiveState>(initial);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function refresh() {
      try {
        const response = await fetch("/api/analytics/live", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { liveSessions: number; withTeam: number; byChannel: Record<string, number>; at: string };
        if (!cancelled) {
          setLive({ liveSessions: body.liveSessions, withTeam: body.withTeam, byChannel: body.byChannel ?? {}, at: body.at, failed: false });
        }
      } catch {
        if (!cancelled) setLive((current) => ({ ...current, failed: true }));
      }
    }

    function start() {
      if (timer) return;
      void refresh();
      timer = setInterval(() => void refresh(), LIVE_POLL_MS);
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    function onVisibility() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return live;
}

// ---------- charts ----------

function LatencyChart({ buckets, timeZone }: { buckets: AnalyticsDashboard["latency24h"]; timeZone: string }) {
  const [showTable, setShowTable] = useState(false);
  const replies = buckets.reduce((total, bucket) => total + bucket.count, 0);
  const withData = buckets.filter((bucket) => bucket.avgMs !== null);
  const slowest = withData.reduce<(typeof buckets)[number] | null>(
    (worst, bucket) => (worst === null || (bucket.avgMs ?? 0) > (worst.avgMs ?? 0) ? bucket : worst),
    null,
  );
  const fastest = withData.reduce<(typeof buckets)[number] | null>(
    (best, bucket) => (best === null || (bucket.avgMs ?? Infinity) < (best.avgMs ?? Infinity) ? bucket : best),
    null,
  );
  const hourRange = (index: number) => `${buckets[index].label}–${index === buckets.length - 1 ? "now" : buckets[index + 1].label}`;
  const summary =
    replies === 0
      ? "System latency over the last 24 hours: no AI replies."
      : withData.length === 1
        ? `System latency over the last 24 hours, ${formatNumber(replies)} AI replies, all at ${withData[0].label}: average ${formatMs(withData[0].avgMs)}, p95 ${formatMs(withData[0].p95Ms)}.`
        : `System latency over the last 24 hours, ${formatNumber(replies)} AI replies. Average per hour ranges from ${formatMs(fastest?.avgMs)} at ${fastest?.label} to ${formatMs(slowest?.avgMs)} at ${slowest?.label}.`;

  const table = (
    <table className="w-full min-w-[420px] text-left text-sm">
      <caption className="sr-only">System latency per hour, last 24 hours ({timeZone})</caption>
      <thead>
        <tr className="border-b border-white/10 text-xs text-slate-400">
          <th scope="col" className="py-2 pr-3 font-medium">Hour</th>
          <th scope="col" className="px-3 py-2 text-right font-medium">Avg</th>
          <th scope="col" className="px-3 py-2 text-right font-medium">p95</th>
          <th scope="col" className="py-2 pl-3 text-right font-medium">Replies</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5 tabular-nums">
        {buckets.map((bucket, index) => (
          <tr key={bucket.start}>
            <th scope="row" className="py-1.5 pr-3 font-normal text-slate-300">{hourRange(index)}</th>
            <td className="px-3 py-1.5 text-right text-slate-200">{formatMs(bucket.avgMs)}</td>
            <td className="px-3 py-1.5 text-right text-slate-200">{formatMs(bucket.p95Ms)}</td>
            <td className="py-1.5 pl-3 text-right text-slate-200">{formatNumber(bucket.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <Card
      title="System latency"
      description={`Average AI response time per hour over the last 24 hours (${timeZone}). Always the last 24 hours, whatever date range is selected above.`}
      action={replies > 0 ? <ViewToggle showTable={showTable} onToggle={() => setShowTable((value) => !value)} label="system latency" /> : null}
    >
      {replies === 0 ? (
        <EmptyChart title="No AI replies in the last 24 hours">
          Each AI reply on Website, WhatsApp, Slack or Email records how long it took. The chart fills in as soon as your assistant answers customers.
        </EmptyChart>
      ) : showTable ? (
        <div className="-mx-5 max-h-[320px] overflow-auto px-5">{table}</div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <LegendItem color={SERIES_PRIMARY} label="Average" shape="line" />
            <LegendItem color={SERIES_MUTED} label="p95 (slowest 5%)" shape="line" dashed />
            <span className="text-xs text-slate-500">Gaps = hours without replies</span>
          </div>
          <LineChart
            labels={buckets.map((bucket) => bucket.label)}
            ariaLabel={summary}
            xLabelEvery={4}
            yTickFormat={(value, maxTick) => msTickFormatter(maxTick)(value)}
            series={[
              { key: "p95", label: "p95", color: SERIES_MUTED, dashed: true, values: buckets.map((bucket) => bucket.p95Ms) },
              { key: "avg", label: "Average", color: SERIES_PRIMARY, values: buckets.map((bucket) => bucket.avgMs) },
            ]}
            renderTooltip={(index) => {
              const bucket = buckets[index];
              return (
                <>
                  <TooltipTitle>{hourRange(index)}</TooltipTitle>
                  {bucket.count === 0 ? (
                    <p className="text-slate-300">No replies this hour</p>
                  ) : (
                    <>
                      <TooltipRow color={SERIES_PRIMARY} label="average" value={formatMs(bucket.avgMs)} />
                      <TooltipRow color={SERIES_MUTED} label="p95" value={formatMs(bucket.p95Ms)} dashed />
                      <TooltipRow shape="none" label={bucket.count === 1 ? "reply" : "replies"} value={formatNumber(bucket.count)} />
                    </>
                  )}
                </>
              );
            }}
          />
          <div className="sr-only">{table}</div>
        </>
      )}
    </Card>
  );
}

function VolumeChart({
  volume,
  channel,
  rangeLabel,
}: {
  volume: AnalyticsDashboard["volume"];
  channel: string | null;
  rangeLabel: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const channels = CHANNEL_ORDER.filter((item) => !channel || item === channel);
  const series = channels.map((item) => ({ key: item, label: channelName(item), color: CHANNEL_COLORS[item] }));
  const total = volume.reduce((sum, row) => sum + row.total, 0);
  const busiest = volume.reduce<(typeof volume)[number] | null>((best, row) => (best === null || row.total > best.total ? row : best), null);
  const summary =
    total === 0
      ? `Conversation volume, ${rangeLabel}: no conversations.`
      : `Conversation volume per day, ${rangeLabel}: ${formatNumber(total)} conversations over ${volume.length} days, ${channels
          .map((item) => `${channelName(item)} ${formatNumber(volume.reduce((sum, row) => sum + row[item], 0))}`)
          .join(", ")}. Busiest day ${busiest ? dayLabel(busiest.date, true) : ""} with ${formatNumber(busiest?.total ?? 0)}.`;

  const table = (
    <table className="w-full min-w-[520px] text-left text-sm">
      <caption className="sr-only">Conversations per day by channel, {rangeLabel}</caption>
      <thead>
        <tr className="border-b border-white/10 text-xs text-slate-400">
          <th scope="col" className="py-2 pr-3 font-medium">Day</th>
          {channels.map((item) => (
            <th key={item} scope="col" className="px-3 py-2 text-right font-medium">{channelName(item)}</th>
          ))}
          <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
          <th scope="col" className="py-2 pl-3 text-right font-medium">AI replies</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5 tabular-nums">
        {[...volume].reverse().map((row) => (
          <tr key={row.date}>
            <th scope="row" className="py-1.5 pr-3 font-normal text-slate-300">{dayLabel(row.date, true)}</th>
            {channels.map((item) => (
              <td key={item} className="px-3 py-1.5 text-right text-slate-200">{formatNumber(row[item])}</td>
            ))}
            <td className="px-3 py-1.5 text-right font-semibold text-white">{formatNumber(row.total)}</td>
            <td className="py-1.5 pl-3 text-right text-slate-200">{formatNumber(row.aiReplies)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <Card
      title="Conversation volume"
      description={`New conversations per day by channel, ${rangeLabel}. Email counts tickets created from email.`}
      action={total > 0 ? <ViewToggle showTable={showTable} onToggle={() => setShowTable((value) => !value)} label="conversation volume" /> : null}
    >
      {total === 0 ? (
        <EmptyChart title="No conversations in this period">
          Conversations started on your website widget, WhatsApp or Slack, and tickets created from email, are counted here per day.
        </EmptyChart>
      ) : showTable ? (
        <div className="-mx-5 max-h-[320px] overflow-auto px-5">{table}</div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-4">
            {series.map((item) => (
              <LegendItem key={item.key} color={item.color} label={item.label} />
            ))}
          </div>
          <StackedBarChart
            ariaLabel={summary}
            series={series}
            categories={volume.map((row) => ({
              key: row.date,
              label: dayLabel(row.date),
              values: { WEB_WIDGET: row.WEB_WIDGET, WHATSAPP: row.WHATSAPP, SLACK: row.SLACK, EMAIL: row.EMAIL },
            }))}
            renderTooltip={(index) => {
              const row = volume[index];
              return (
                <>
                  <TooltipTitle>{dayLabel(row.date, true)}</TooltipTitle>
                  {[...series].reverse().map((item) => (
                    <TooltipRow key={item.key} color={item.color} label={item.label} value={formatNumber(row[item.key as keyof typeof row] as number)} />
                  ))}
                  <div className="mt-1 border-t border-white/10 pt-1">
                    <TooltipRow shape="none" label="total" value={formatNumber(row.total)} />
                    <TooltipRow shape="none" label="AI replies" value={formatNumber(row.aiReplies)} />
                  </div>
                </>
              );
            }}
          />
          <div className="sr-only">{table}</div>
        </>
      )}
    </Card>
  );
}

function ResolutionMix({ resolutions, rangeLabel }: { resolutions: AnalyticsDashboard["resolutions"]; rangeLabel: string }) {
  const finished = resolutions.AI_RESOLVED + resolutions.HUMAN_HANDLED + resolutions.UNANSWERED;
  const segments = [
    { key: "AI_RESOLVED", label: "Resolved by AI", value: resolutions.AI_RESOLVED, color: STATUS_COLORS.good },
    { key: "HUMAN_HANDLED", label: "Handled by team", value: resolutions.HUMAN_HANDLED, color: STATUS_COLORS.warning },
    { key: "UNANSWERED", label: "Unanswered", value: resolutions.UNANSWERED, color: STATUS_COLORS.neutral },
  ];
  const summary =
    finished === 0
      ? "No finished conversations."
      : `${formatNumber(finished)} finished conversations: ${segments.map((item) => `${item.label} ${formatNumber(item.value)} (${formatShare(item.value, finished)})`).join(", ")}.`;

  return (
    <Card title="Resolution mix" description={`How conversations that finished in the ${rangeLabel} ended.`}>
      {finished === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs leading-5 text-slate-400">
          No conversations finished in this period yet. A conversation is counted when it closes (by the customer, the team or the idle timeout).
        </p>
      ) : (
        <div role="img" aria-label={summary} className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px]">
          {segments
            .filter((item) => item.value > 0)
            .map((item) => (
              <span
                key={item.key}
                className="h-full min-w-[3px]"
                style={{ width: `${(item.value / finished) * 100}%`, backgroundColor: item.color }}
                title={`${item.label}: ${formatNumber(item.value)} (${formatShare(item.value, finished)})`}
              />
            ))}
        </div>
      )}
      <dl className="mt-4 space-y-2">
        {segments.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
            <dt className="flex items-center gap-2 text-slate-300">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: item.color }} aria-hidden="true" />
              {item.label}
            </dt>
            <dd className="tabular-nums text-slate-200">
              <span className="font-semibold text-white">{formatNumber(item.value)}</span>
              <span className="ml-2 inline-block w-10 text-right text-slate-500">{formatShare(item.value, finished)}</span>
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2 text-sm">
          <dt className="flex items-center gap-2 text-slate-300">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS.info }} aria-hidden="true" />
            Open right now
          </dt>
          <dd className="tabular-nums">
            <span className="font-semibold text-white">{formatNumber(resolutions.open)}</span>
            <span className="ml-2 inline-block w-10 text-right text-slate-500">{EMPTY_VALUE}</span>
          </dd>
        </div>
      </dl>
    </Card>
  );
}

// ---------- page ----------

export function AnalyticsOverviewWorkspace({ data, canExport }: AnalyticsOverviewWorkspaceProps) {
  const searchParams = useSearchParams();
  const { kpis, changes, range } = data;
  const period = PERIOD_LABELS[range.preset] ?? PERIOD_LABELS.custom;
  const rangeLabel = RANGE_LABELS[range.preset] ?? RANGE_LABELS.custom;

  const live = useLiveSessions({
    liveSessions: kpis.liveSessions,
    withTeam: kpis.liveWithTeam,
    byChannel: Object.fromEntries(data.channels.map((item) => [item.channel, item.live])),
    at: null,
    failed: false,
  });
  // FR-11.4 counts every channel; a channel filter narrows the headline to that channel.
  const liveValue = range.channel ? (live.byChannel[range.channel] ?? 0) : live.liveSessions;
  const liveTotal = live.at ? live.liveSessions : Object.values(live.byChannel).reduce((sum, value) => sum + value, 0);

  const exportQuery = new URLSearchParams();
  for (const key of EXPORT_KEYS) {
    const value = searchParams.get(key);
    if (value) exportQuery.set(key, value);
  }
  const exportSuffix = exportQuery.toString() ? `&${exportQuery.toString()}` : "";

  const hasData =
    kpis.aiReplies > 0 ||
    kpis.conversations > 0 ||
    kpis.leadsCaptured > 0 ||
    kpis.finishedConversations > 0 ||
    data.recent.length > 0 ||
    liveTotal > 0;

  const exportButtonClass =
    "pressable inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-[#111111] px-3 text-xs font-semibold text-white transition hover:bg-[#1a1a1a]";
  const downloadIcon = (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );

  return (
    <div className="px-5 py-4 md:px-6">
      <AnalyticsNav
        title="Analytics"
        description="How your assistant performs across Website, WhatsApp, Slack and Email: speed, automation, leads and live traffic."
        range={range}
        actions={
          canExport ? (
            <>
              <a href={`/api/analytics/export?type=interactions${exportSuffix}`} className={exportButtonClass} download>
                {downloadIcon}
                Export interactions
              </a>
              <a href={`/api/analytics/export?type=conversations${exportSuffix}`} className={exportButtonClass} download>
                {downloadIcon}
                Export conversations
              </a>
            </>
          ) : null
        }
      />

      {!hasData ? (
        <div className="mt-5 rounded-[22px] border border-dashed border-white/15 bg-[#0a0a0a] px-6 py-8">
          <h2 className="heading-font text-lg font-semibold text-white">No analytics for this period yet</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Numbers appear as soon as customers talk to your assistant. Every AI reply records its response time and whether it was
            answered from your knowledge base, every conversation records how it ended when it closes, and leads are counted when they
            are captured. Embed the chat widget on your website or connect WhatsApp, Slack or Email to start collecting data
            {range.preset === "24h" || range.preset === "7d" ? ", or choose a longer date range above" : ""}.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/dashboard/chatbots"
              className="pressable inline-flex h-9 items-center rounded-lg bg-white px-4 text-xs font-semibold text-[#050505] transition hover:bg-neutral-200"
            >
              Embed the chat widget
            </Link>
            <Link href="/dashboard/integrations" className={exportButtonClass}>
              Connect channels
            </Link>
          </div>
        </div>
      ) : null}

      {/* FR-11.1–11.4 primary KPIs */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PrimaryKpi
          label="Avg. response time"
          value={formatMs(kpis.avgResponseMs)}
          detail={
            kpis.aiReplies > 0 ? (
              <>
                p95 {formatMs(kpis.p95ResponseMs)} · {formatNumber(kpis.aiReplies)} AI {kpis.aiReplies === 1 ? "reply" : "replies"}
              </>
            ) : (
              "No AI replies in this period."
            )
          }
          footer={<ChangeBadge change={changes.avgResponseMs} kind="relative" better="down" period={period} />}
        />
        <PrimaryKpi
          label="Automation rate"
          value={formatPercent(kpis.automationRate)}
          detail={
            kpis.finishedConversations > 0
              ? `${formatNumber(kpis.aiResolved)} of ${formatNumber(kpis.finishedConversations)} finished conversations resolved by AI.`
              : "No conversations finished in this period yet."
          }
          footer={<ChangeBadge change={changes.automationRate} kind="points" better="up" period={period} />}
        />
        <PrimaryKpi
          label="Leads captured"
          value={formatNumber(kpis.leadsCaptured)}
          detail={
            kpis.leadsCaptured > 0
              ? `${formatNumber(kpis.hotLeads)} hot (score 70+) in the ${rangeLabel}.`
              : `No new leads in the ${rangeLabel}.`
          }
          footer={<ChangeBadge change={changes.leadsCaptured} kind="relative" better="up" period={period} />}
          href="/dashboard/leads"
          hrefLabel="View leads"
        />
        <PrimaryKpi
          label={
            <span className="inline-flex items-center gap-2">
              Live sessions
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                Live
              </span>
            </span>
          }
          accent={<LiveDot active={!live.failed} />}
          value={<span aria-live="polite">{formatNumber(liveValue)}</span>}
          detail={
            <>
              {range.channel
                ? `Active on ${channelName(range.channel)} right now · ${formatNumber(liveTotal)} across all channels.`
                : `Active across all channels right now · ${live.withTeam === null ? EMPTY_VALUE : formatNumber(live.withTeam)} with team.`}
            </>
          }
          footer={
            <>
              <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Live sessions by channel">
                {CHANNEL_ORDER.map((item) => (
                  <li key={item} className="inline-flex items-center gap-1 text-xs text-slate-300" title={channelName(item)}>
                    <ChannelIcon channel={item} className="h-3.5 w-3.5 text-slate-500" />
                    <span className="sr-only">{channelName(item)}:</span>
                    <span className="tabular-nums">{formatNumber(live.byChannel[item] ?? 0)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-slate-500">
                {live.failed ? "Live updates paused (connection problem). Retrying every 15 s." : "Refreshes every 15 s while this tab is open."}
              </p>
            </>
          }
          href="/dashboard/chats"
          hrefLabel="Open chats"
        />
      </div>

      {/* Secondary KPIs */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SecondaryKpi
          label="Conversations"
          value={formatNumber(kpis.conversations)}
          hint={`${formatNumber(kpis.chatConversations)} chats + ${formatNumber(kpis.emailTickets)} email tickets started in the ${rangeLabel}.`}
          extra={<ChangeBadge change={changes.conversations} kind="relative" better="neutral" period={period} />}
        />
        <SecondaryKpi
          label="Engagement rate"
          value={formatPercent(kpis.engagementRate)}
          hint="Chats where the customer sent 2 or more messages."
        />
        <SecondaryKpi
          label="Escalation rate"
          value={formatPercent(kpis.escalationRate)}
          hint="Chats a team member took over from the AI."
        />
        <SecondaryKpi
          label="Answered from knowledge"
          value={formatPercent(kpis.groundedRate)}
          hint="AI replies backed by a knowledge-base match above the agent's confidence threshold."
        />
        <SecondaryKpi
          label="Fallback rate"
          value={formatPercent(kpis.fallbackRate)}
          hint="AI replies answered from the knowledge base because the AI model was unavailable."
        />
        <SecondaryKpi
          label="Helpful rate"
          value={formatPercent(kpis.helpfulRate)}
          hint={kpis.feedbackCount > 0 ? `Thumbs-up share from ${formatNumber(kpis.feedbackCount)} customer ratings.` : "Thumbs-up share of customer ratings (none yet)."}
          extra={kpis.feedbackCount > 0 ? <ChangeBadge change={changes.helpfulRate} kind="points" better="up" period={period} /> : null}
        />
        <SecondaryKpi
          label="Avg. first response"
          value={formatMs(kpis.avgFirstResponseMs)}
          hint="Customer's first message to the first AI or team reply (latest 500 chats)."
        />
        <SecondaryKpi
          label="Avg. conversation length"
          value={formatDuration(kpis.avgDurationSeconds)}
          hint="Start to last activity, for conversations that finished."
        />
        <SecondaryKpi
          label="Returning customers"
          value={formatNumber(kpis.returningCustomers)}
          hint="Chats that continued an earlier conversation of the same customer."
        />
      </div>

      {/* FR-11.5 + volume */}
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <LatencyChart buckets={data.latency24h} timeZone={range.timeZone} />
        <VolumeChart volume={data.volume} channel={range.channel} rangeLabel={rangeLabel} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_2fr]">
        <ResolutionMix resolutions={data.resolutions} rangeLabel={rangeLabel} />

        <Card title="Channels" description={`Traffic and AI performance per channel, ${rangeLabel}. "Live now" is right now.`}>
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs text-slate-400">
                  <th scope="col" className="py-2 pr-3 font-medium">Channel</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Conversations</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">AI replies</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Avg response</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Automation</th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium">Live now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 tabular-nums">
                {data.channels.map((row) => (
                  <tr key={row.channel}>
                    <th scope="row" className="py-2.5 pr-3 font-medium text-white">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: CHANNEL_COLORS[row.channel] }} aria-hidden="true" />
                        <ChannelLabel channel={row.channel} />
                      </span>
                    </th>
                    <td className="px-3 py-2.5 text-right text-slate-200">{formatNumber(row.conversations)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-200">{formatNumber(row.aiReplies)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-200">{formatMs(row.avgResponseMs)}</td>
                    <td
                      className="px-3 py-2.5 text-right text-slate-200"
                      title={row.channel === "EMAIL" ? "Email tickets are not chat sessions, so they have no automation rate." : undefined}
                    >
                      {formatPercent(row.automationRate)}
                    </td>
                    <td className="py-2.5 pl-3 text-right text-slate-200">{formatNumber(live.byChannel[row.channel] ?? row.live)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* FR-11.6 / FR-11.7 */}
      <Card
        className="mt-5"
        title="Recent interactions"
        description="The latest conversations on every channel, most recent first."
        action={
          <Link href="/dashboard/chats" className="text-xs font-semibold text-slate-300 hover:text-white">
            All chats <span aria-hidden="true">&rarr;</span>
          </Link>
        }
      >
        {data.recent.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs leading-5 text-slate-400">
            No conversations yet. They appear here as soon as a customer writes on your website widget, WhatsApp or Slack.
          </p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs text-slate-400">
                  <th scope="col" className="py-2 pr-3 font-medium">Customer</th>
                  <th scope="col" className="px-3 py-2 font-medium">Channel</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Duration</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Messages</th>
                  <th scope="col" className="px-3 py-2 font-medium">Last activity</th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.recent.map((row) => (
                  <tr key={row.sessionId}>
                    <th scope="row" className="max-w-[220px] py-2.5 pr-3 font-medium text-white">
                      <span className="block truncate" title={row.customer}>{row.customer}</span>
                    </th>
                    <td className="px-3 py-2.5 text-slate-200">
                      <ChannelLabel channel={row.channel} />
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-200">{formatDuration(row.durationSeconds)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-200">{formatNumber(row.messageCount)}</td>
                    <td className="px-3 py-2.5 text-slate-400">
                      <RelativeTime value={row.lastActivityAt} className="whitespace-nowrap text-xs" />
                    </td>
                    <td className="py-2.5 pl-3">
                      <div className="flex justify-end gap-1.5">
                        <Link
                          href={`/dashboard/chats?session=${encodeURIComponent(row.sessionId)}`}
                          className="pressable rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-white/5 hover:text-white"
                          aria-label={`Open conversation with ${row.customer} in Chats`}
                        >
                          Open
                        </Link>
                        <a
                          href={`/api/chat-sessions/${encodeURIComponent(row.sessionId)}/transcript`}
                          download
                          className="pressable inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-white/5 hover:text-white"
                          aria-label={`Download transcript of the conversation with ${row.customer}`}
                        >
                          {downloadIcon}
                          Transcript
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        className="mt-5"
        title="Agent performance"
        description={`AI replies per agent, ${rangeLabel}. Helpful % comes from customer thumbs up / down.`}
        action={
          <Link href="/dashboard/ai-agents" className="text-xs font-semibold text-slate-300 hover:text-white">
            All agents <span aria-hidden="true">&rarr;</span>
          </Link>
        }
      >
        {data.agents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs leading-5 text-slate-400">
            No active AI agents with replies in this period. Create or activate an agent to start answering customers.
          </p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs text-slate-400">
                  <th scope="col" className="py-2 pr-3 font-medium">Agent</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Replies</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Avg response</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">p95</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">From knowledge</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Fallback</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Helpful</th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 tabular-nums">
                {data.agents.map((agent) => (
                  <tr key={agent.id}>
                    <th scope="row" className="py-2.5 pr-3 font-medium">
                      <span className="flex min-w-0 items-center gap-2">
                        <Link href={`/dashboard/ai-agents/${agent.id}`} className="truncate text-white hover:underline">
                          {agent.name}
                        </Link>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            agentStatusClass[agent.status] ?? agentStatusClass.DRAFT
                          }`}
                        >
                          {agent.status.charAt(0)}
                          {agent.status.slice(1).toLowerCase()}
                        </span>
                      </span>
                    </th>
                    <td className="px-3 py-2.5 text-right text-slate-200">{formatNumber(agent.replies)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-200">{formatMs(agent.avgResponseMs)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-200">{formatMs(agent.p95ResponseMs)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-200">{formatPercent(agent.groundedRate)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-200">{formatPercent(agent.fallbackRate)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-200">{formatPercent(agent.helpfulRate)}</td>
                    <td className="py-2.5 pl-3 text-right text-slate-200">{formatNumber(agent.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-[11px] text-slate-500">
        Generated <RelativeTime value={data.generatedAt} /> · times in {range.timeZone}
      </p>
    </div>
  );
}
