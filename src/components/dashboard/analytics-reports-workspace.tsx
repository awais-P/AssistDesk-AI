"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { AnalyticsNav } from "@/src/components/dashboard/analytics-nav";
import {
  AnsweredBadge,
  BarList,
  CHANNEL_ORDER,
  ChannelChips,
  EmptyState,
  ORDINAL_RAMP,
  Panel,
  SEQUENTIAL_RAMP,
  SERIES_COLOR,
  StatTile,
  channelLabel,
  formatDateTime,
  formatEnum,
  formatHour,
  formatHourRange,
  formatNumber,
  formatPercent,
  formatSeconds,
  orderedEntries,
  plural,
  secondaryButtonClass,
  textLinkClass,
} from "@/src/components/dashboard/analytics-ui";
import type { AnalyticsReports } from "@/src/lib/analytics";
import { leadSourceLabels, leadStatusLabels } from "@/src/lib/lead-form";

type AnalyticsReportsWorkspaceProps = {
  data: AnalyticsReports;
  canExport: boolean;
};

type FaqItem = AnalyticsReports["faq"][number];
type FaqSort = "count" | "answered" | "recent";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FUNNEL_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED"] as const;
const TICKET_STATUS_ORDER = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const TICKET_PRIORITY_ORDER = ["URGENT", "HIGH", "MEDIUM", "LOW"];
const LOW_ANSWERED_RATE = 0.5;

function useQueryString(omit: string[] = []) {
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());

  for (const key of omit) {
    params.delete(key);
  }

  return params.toString();
}

export function AnalyticsReportsWorkspace({ data, canExport }: AnalyticsReportsWorkspaceProps) {
  const query = useQueryString(["type"]);
  const suffix = query ? `&${query}` : "";
  const improveHref = query ? `/dashboard/analytics/improve?${query}` : "/dashboard/analytics/improve";
  const channelFiltered = data.range.channel !== null;

  return (
    <div className="px-5 py-4 md:px-6">
      <AnalyticsNav
        title="Reports"
        description="What customers ask and how they behave, from every conversation on every channel."
        range={data.range}
        actions={
          canExport ? (
            <>
              <a href={`/api/analytics/export?type=faq${suffix}`} className={secondaryButtonClass}>
                Export FAQ
              </a>
              <a href={`/api/analytics/export?type=interactions${suffix}`} className={secondaryButtonClass}>
                Export interactions
              </a>
            </>
          ) : null
        }
      />

      <div className="mt-6 flex flex-col gap-8">
        <FaqSection data={data} improveHref={improveHref} />
        <BehaviorSection behavior={data.behavior} timeZone={data.range.timeZone} channelFiltered={channelFiltered} />
        <LeadsSection leads={data.leads} />
        <TicketsSection tickets={data.tickets} channelFiltered={channelFiltered} />
      </div>
    </div>
  );
}

// ---------- Frequently asked questions (FE-4) ----------

function FaqSection({ data, improveHref }: { data: AnalyticsReports; improveHref: string }) {
  const [sort, setSort] = useState<FaqSort>("count");
  const [filter, setFilter] = useState("");
  const maxCount = Math.max(1, ...data.faq.map((item) => item.count));

  const rows = useMemo(() => {
    const ranked = data.faq.map((item, index) => ({ item, rank: index + 1 }));
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? ranked.filter(({ item }) => [item.label, ...item.examples].some((text) => text.toLowerCase().includes(needle)))
      : ranked;

    if (sort === "answered") {
      return [...filtered].sort((a, b) => (a.item.answeredRate ?? 2) - (b.item.answeredRate ?? 2) || a.rank - b.rank);
    }

    if (sort === "recent") {
      return [...filtered].sort((a, b) => b.item.lastAskedAt.localeCompare(a.item.lastAskedAt));
    }

    return filtered;
  }, [data.faq, filter, sort]);

  const method = data.faqMethod === "semantic" ? "Grouped by meaning" : "Grouped by similar wording";

  return (
    <section aria-labelledby="faq-title">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 id="faq-title" className="text-lg font-semibold text-white">
            Frequently asked questions
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {method} · {plural(data.questionsAnalysed, "question")} analysed
          </p>
        </div>
        {data.faq.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="faq-filter" className="sr-only">
              Filter questions
            </label>
            <input
              id="faq-filter"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter questions"
              className="h-9 w-full rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-white sm:w-56"
            />
            <label htmlFor="faq-sort" className="sr-only">
              Sort questions
            </label>
            <select
              id="faq-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as FaqSort)}
              className="h-9 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-slate-200 outline-none focus:border-white"
            >
              <option value="count">Most asked</option>
              <option value="answered">Least answered first</option>
              <option value="recent">Most recent</option>
            </select>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-[22px] border border-white/10 bg-[#0a0a0a]">
        {data.faq.length === 0 ? (
          <EmptyState title="No questions in this period">
            Questions appear here once customers talk to the assistant on your website, WhatsApp, Slack or by
            email. Try a longer date range.
          </EmptyState>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">No questions match “{filter}”.</p>
        ) : (
          <>
            <div className="hidden grid-cols-[3rem_minmax(0,1fr)_12rem_13rem_8rem] gap-4 border-b border-white/10 px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
              <span>#</span>
              <span>Question</span>
              <span>Times asked</span>
              <span>Answered from knowledge</span>
              <span>Last asked</span>
            </div>
            <ol>
              {rows.map(({ item, rank }) => (
                <FaqRow
                  key={`${rank}-${item.label}`}
                  item={item}
                  rank={rank}
                  maxCount={maxCount}
                  timeZone={data.range.timeZone}
                  improveHref={improveHref}
                />
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

function FaqRow({
  item,
  rank,
  maxCount,
  timeZone,
  improveHref,
}: {
  item: FaqItem;
  rank: number;
  maxCount: number;
  timeZone: string;
  improveHref: string;
}) {
  const otherWordings = item.examples.filter((example) => example.trim() !== item.label.trim());
  const lowAnswered = item.answeredRate !== null && item.answeredRate < LOW_ANSWERED_RATE;

  return (
    <li className="grid gap-3 border-b border-white/10 px-5 py-4 last:border-b-0 lg:grid-cols-[3rem_minmax(0,1fr)_12rem_13rem_8rem] lg:gap-4">
      <span className="text-sm font-semibold tabular-nums text-slate-500">{rank}</span>

      <div className="min-w-0">
        <p className="break-words font-medium text-white">{item.label}</p>
        <div className="mt-2">
          <ChannelChips channels={item.channels} />
        </div>
        {otherWordings.length > 0 ? (
          <details className="group mt-2 text-sm">
            <summary className="cursor-pointer list-none text-slate-400 transition hover:text-white [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="mr-1 inline-block transition group-open:rotate-90">
                ›
              </span>
              Other ways it was asked ({otherWordings.length})
            </summary>
            <ul className="mt-2 space-y-1 border-l border-white/10 pl-3 text-slate-400">
              {otherWordings.map((example) => (
                <li key={example} className="break-words">
                  “{example}”
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <div>
        <p className="text-sm text-slate-200">
          <span className="font-semibold tabular-nums text-white">{formatNumber(item.count)}</span>
          <span className="text-slate-500"> · {formatPercent(item.share)} of questions</span>
        </p>
        <div className="mt-1.5 h-2 rounded-r-[4px] bg-white/[0.05]" role="presentation">
          <div
            className="h-2 rounded-r-[4px]"
            style={{ width: `${Math.max(2, (item.count / maxCount) * 100)}%`, backgroundColor: SERIES_COLOR }}
          />
        </div>
      </div>

      <div>
        <span className="mr-2 text-xs text-slate-500 lg:hidden">Answered from knowledge</span>
        <AnsweredBadge rate={item.answeredRate} />
        {lowAnswered ? (
          <Link href={improveHref} className="mt-1.5 block text-sm font-medium text-slate-300 transition hover:text-white">
            Teach the assistant →
          </Link>
        ) : null}
      </div>

      <p className="text-sm text-slate-400">
        <span className="mr-2 text-xs text-slate-500 lg:hidden">Last asked</span>
        {formatDateTime(item.lastAskedAt, timeZone)}
      </p>
    </li>
  );
}

// ---------- Customer behaviour (FE-4, FE-1) ----------

type Behavior = AnalyticsReports["behavior"];

function BehaviorSection({
  behavior,
  timeZone,
  channelFiltered,
}: {
  behavior: Behavior;
  timeZone: string;
  channelFiltered: boolean;
}) {
  const totalCustomers = behavior.newCustomers + behavior.returningCustomers;
  const channelItems = orderedEntries(behavior.channelMix, CHANNEL_ORDER).map(([key, value]) => ({
    key,
    label: channelLabel(key),
    value,
  }));

  return (
    <section aria-labelledby="behavior-title">
      <h2 id="behavior-title" className="text-lg font-semibold text-white">
        Customer behaviour
      </h2>
      <p className="mt-1 text-sm text-slate-500">Who talks to you, how long conversations run and when customers write.</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="New customers"
          value={formatNumber(behavior.newCustomers)}
          detail={totalCustomers > 0 ? `${formatPercent(behavior.newCustomers / totalCustomers)} of customers seen` : "First seen in this period"}
        />
        <StatTile
          label="Returning customers"
          value={formatNumber(behavior.returningCustomers)}
          detail={channelFiltered ? "Customers on every channel" : "Came back after an earlier visit"}
        />
        <StatTile label="Conversations" value={formatNumber(behavior.conversations)} detail="Started in this period" />
        <StatTile
          label="Messages per conversation"
          value={behavior.avgMessagesPerConversation === null ? "—" : String(behavior.avgMessagesPerConversation)}
          detail="Average, customer and replies"
        />
        <StatTile
          label="Conversation length"
          value={formatSeconds(behavior.avgDurationSeconds)}
          detail="Average, first to last message"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="When customers write" description="Busiest day and hours, in the workspace time zone.">
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-slate-500">Busiest day</dt>
              <dd className="mt-1 text-xl font-semibold text-white">{behavior.busiestDay ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Peak hours</dt>
              <dd className="mt-1">
                {behavior.peakHours.length === 0 ? (
                  <span className="text-xl font-semibold text-white">—</span>
                ) : (
                  <ol className="space-y-1.5">
                    {behavior.peakHours.map((peak, index) => (
                      <li key={peak.hour} className="flex items-baseline justify-between gap-3">
                        <span className={index === 0 ? "text-xl font-semibold text-white" : "text-slate-200"}>
                          {formatHourRange(peak.hour)}
                        </span>
                        <span className="tabular-nums text-slate-400">{plural(peak.total, "message")}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </dd>
            </div>
            <p className="text-xs text-slate-500">{timeZone}</p>
          </dl>
        </Panel>
        <div className="lg:col-span-2">
          <Panel title="Channel mix" description="Where conversations started.">
            <BarList items={channelItems} emptyText="No conversations in this period." />
          </Panel>
        </div>
      </div>

      <div className="mt-4">
        <Panel
          title="Activity by day and hour"
          description="Customer messages per hour of the week. Darker means fewer, lighter means more."
        >
          <ActivityHeatmap heatmap={behavior.heatmap} hourTotals={behavior.hourTotals} />
        </Panel>
      </div>
    </section>
  );
}

type Tip = { text: string; left: number; top: number };

function heatLevel(value: number, max: number) {
  if (value <= 0 || max <= 0) {
    return -1;
  }

  return Math.min(SEQUENTIAL_RAMP.length - 1, Math.ceil((value / max) * SEQUENTIAL_RAMP.length) - 1);
}

function ActivityHeatmap({ heatmap, hourTotals }: { heatmap: number[][]; hourTotals: number[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [showTable, setShowTable] = useState(false);
  const max = Math.max(0, ...heatmap.flat());
  const maxHour = Math.max(0, ...hourTotals);
  const total = hourTotals.reduce((sum, value) => sum + value, 0);

  if (total === 0) {
    return (
      <EmptyState title="No customer messages in this period">
        The heatmap shows when customers write to you, so you can plan team cover for the busiest hours.
      </EmptyState>
    );
  }

  function showTip(event: React.PointerEvent<HTMLElement>, text: string) {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const box = container.getBoundingClientRect();
    const cell = event.currentTarget.getBoundingClientRect();
    setTip({ text, left: cell.left - box.left + cell.width / 2, top: cell.top - box.top });
  }

  // Legend: each colour step covers an equal slice of the busiest hour's count.
  const legend = SEQUENTIAL_RAMP.map((color, index) => {
    const low = Math.floor((index / SEQUENTIAL_RAMP.length) * max) + 1;
    const high = Math.floor(((index + 1) / SEQUENTIAL_RAMP.length) * max);
    return { color, label: low >= high ? formatNumber(high) : `${formatNumber(low)}–${formatNumber(high)}`, empty: low > high };
  }).filter((step) => !step.empty);

  const summary = `Customer messages by weekday and hour. Busiest: ${(() => {
    let best = { day: 0, hour: 0, value: -1 };
    heatmap.forEach((row, day) =>
      row.forEach((value, hour) => {
        if (value > best.value) best = { day, hour, value };
      }),
    );
    return `${WEEKDAYS[best.day]} ${formatHourRange(best.hour)}, ${plural(best.value, "message")}`;
  })()}.`;

  return (
    <div>
      <div ref={containerRef} className="relative" onPointerLeave={() => setTip(null)}>
        <div className="overflow-x-auto pb-2" onScroll={() => setTip(null)}>
        <div className="min-w-[640px]" role="img" aria-label={summary}>
          {/* Grid: weekday label column + 24 hour columns, 2px surface gaps between cells. */}
          <div className="grid grid-cols-[2.75rem_repeat(24,minmax(0,1fr))] gap-[2px]">
            {heatmap.map((row, day) => (
              <div key={WEEKDAYS[day]} className="contents">
                <span className="flex items-center pr-2 text-xs text-slate-400">{WEEKDAY_SHORT[day]}</span>
                {row.map((value, hour) => {
                  const level = heatLevel(value, max);
                  const text = `${WEEKDAYS[day]} ${formatHour(hour)} — ${plural(value, "message")}`;
                  return (
                    <span
                      key={hour}
                      aria-hidden="true"
                      onPointerEnter={(event) => showTip(event, text)}
                      className="h-6 rounded-[3px] transition-[outline] hover:outline hover:outline-2 hover:outline-white/70"
                      style={{ backgroundColor: level < 0 ? "rgba(255,255,255,0.04)" : SEQUENTIAL_RAMP[level] }}
                    />
                  );
                })}
              </div>
            ))}

            {/* Hour labels every 3 hours. */}
            <span />
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={`label-${hour}`} className="whitespace-nowrap pt-1 text-[11px] tabular-nums text-slate-500">
                {hour % 3 === 0 ? formatHour(hour) : ""}
              </span>
            ))}
          </div>

          {/* Messages per hour, all days together. */}
          <div className="mt-4 grid grid-cols-[2.75rem_repeat(24,minmax(0,1fr))] items-end gap-[2px]">
            <span className="self-center pr-2 text-[11px] leading-tight text-slate-500">All days</span>
            {hourTotals.map((value, hour) => {
              const text = `${formatHourRange(hour)} — ${plural(value, "message")}, all days`;
              return (
                <span
                  key={`total-${hour}`}
                  aria-hidden="true"
                  onPointerEnter={(event) => showTip(event, text)}
                  className="flex h-12 items-end"
                >
                  <span
                    className="block w-full rounded-t-[4px]"
                    style={{
                      height: value > 0 ? `${Math.max(6, (value / Math.max(1, maxHour)) * 100)}%` : "2px",
                      backgroundColor: value > 0 ? SERIES_COLOR : "rgba(255,255,255,0.08)",
                    }}
                  />
                </span>
              );
            })}
          </div>
          <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-[2px]">
            <span />
            <span className="h-px bg-white/15" />
          </div>
        </div>
        </div>

        {tip ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-white/10 bg-[#161616] px-2.5 py-1.5 text-xs text-white shadow-lg"
            style={{ left: tip.left, top: tip.top - 6 }}
          >
            {tip.text}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400" aria-label="Legend: messages per hour">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[3px] bg-white/[0.04] ring-1 ring-inset ring-white/10" aria-hidden="true" />
            None
          </span>
          {legend.map((step) => (
            <span key={step.color} className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[3px]" style={{ backgroundColor: step.color }} aria-hidden="true" />
              <span className="tabular-nums">{step.label}</span>
            </span>
          ))}
          <span className="text-slate-500">messages per hour</span>
        </div>
        <button type="button" onClick={() => setShowTable((open) => !open)} aria-expanded={showTable} className={secondaryButtonClass}>
          {showTable ? "Hide table" : "Show as table"}
        </button>
      </div>

      {showTable ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[900px] text-right text-xs tabular-nums">
            <caption className="sr-only">Customer messages by weekday and hour</caption>
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th scope="col" className="px-2 py-2 text-left font-semibold">
                  Day
                </th>
                {Array.from({ length: 24 }, (_, hour) => (
                  <th key={hour} scope="col" className="px-1.5 py-2 font-medium">
                    {String(hour).padStart(2, "0")}
                  </th>
                ))}
                <th scope="col" className="px-2 py-2 font-semibold">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {heatmap.map((row, day) => (
                <tr key={WEEKDAYS[day]} className="border-b border-white/5 text-slate-300">
                  <th scope="row" className="px-2 py-1.5 text-left font-medium text-slate-200">
                    {WEEKDAY_SHORT[day]}
                  </th>
                  {row.map((value, hour) => (
                    <td key={hour} className={`px-1.5 py-1.5 ${value === 0 ? "text-slate-600" : ""}`}>
                      {value}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 font-semibold text-white">{formatNumber(row.reduce((sum, value) => sum + value, 0))}</td>
                </tr>
              ))}
              <tr className="text-slate-200">
                <th scope="row" className="px-2 py-1.5 text-left font-semibold">
                  All
                </th>
                {hourTotals.map((value, hour) => (
                  <td key={hour} className="px-1.5 py-1.5 font-semibold">
                    {value}
                  </td>
                ))}
                <td className="px-2 py-1.5 font-semibold text-white">{formatNumber(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

// ---------- Leads (FE-4) ----------

function LeadsSection({ leads }: { leads: AnalyticsReports["leads"] }) {
  const funnelMax = Math.max(1, ...FUNNEL_STATUSES.map((status) => leads.byStatus[status] ?? 0));
  const lost = leads.byStatus.LOST ?? 0;

  return (
    <section aria-labelledby="leads-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="leads-title" className="text-lg font-semibold text-white">
            Leads
          </h2>
          <p className="mt-1 text-sm text-slate-500">Potential customers captured from conversations in this period.</p>
        </div>
        <Link href="/dashboard/leads" className={`text-sm ${textLinkClass}`}>
          Open leads →
        </Link>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatTile label="Leads captured" value={formatNumber(leads.total)} detail="Created in this period" />
        <StatTile
          label="Conversation to lead"
          value={formatPercent(leads.conversionRate)}
          detail="Conversations that produced a lead"
        />
        <StatTile label="Hot leads" value={formatNumber(leads.hot)} detail="Lead score of 70 or more" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="By status" description="Where this period's leads are now.">
          {leads.total === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No leads in this period.</p>
          ) : (
            <div>
              <ol className="space-y-3">
                {FUNNEL_STATUSES.map((status, index) => {
                  const value = leads.byStatus[status] ?? 0;
                  return (
                    <li key={status}>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-200">{leadStatusLabels[status]}</span>
                        <span className="tabular-nums text-slate-400">
                          {formatNumber(value)} · {formatPercent(value / leads.total)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 rounded-r-[4px] bg-white/[0.05]" role="presentation">
                        {value > 0 ? (
                          <div
                            className="h-2 rounded-r-[4px]"
                            style={{ width: `${Math.max(1.5, (value / funnelMax) * 100)}%`, backgroundColor: ORDINAL_RAMP[index] }}
                          />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3 text-sm">
                <span className="text-slate-400">{leadStatusLabels.LOST}</span>
                <span className="tabular-nums text-slate-400">
                  {formatNumber(lost)} · {formatPercent(lost / leads.total)}
                </span>
              </div>
            </div>
          )}
        </Panel>
        <Panel title="By source" description="How the lead was captured.">
          <BarList
            items={orderedEntries(leads.bySource, ["FORM", "AUTO", "AI_TOOL", "MANUAL"]).map(([key, value]) => ({
              key,
              label: leadSourceLabels[key] ?? formatEnum(key),
              value,
            }))}
            emptyText="No leads in this period."
          />
        </Panel>
        <Panel title="By channel">
          <BarList
            items={orderedEntries(leads.byChannel, CHANNEL_ORDER).map(([key, value]) => ({
              key,
              label: channelLabel(key),
              value,
            }))}
            emptyText="No leads in this period."
          />
        </Panel>
      </div>
    </section>
  );
}

// ---------- Tickets (FE-4) ----------

function TicketsSection({ tickets, channelFiltered }: { tickets: AnalyticsReports["tickets"]; channelFiltered: boolean }) {
  const empty = "No tickets in this period.";

  return (
    <section aria-labelledby="tickets-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="tickets-title" className="text-lg font-semibold text-white">
            Tickets
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {plural(tickets.total, "ticket")} created in this period
            {channelFiltered ? " (tickets from every channel; the channel filter does not apply here)" : ""}.
          </p>
        </div>
        <Link href="/dashboard/reports" className={`text-sm ${textLinkClass}`}>
          Ticket reports →
        </Link>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="By status">
          <BarList
            items={orderedEntries(tickets.byStatus, TICKET_STATUS_ORDER).map(([key, value]) => ({ key, label: formatEnum(key), value }))}
            emptyText={empty}
          />
        </Panel>
        <Panel title="By source">
          <BarList
            items={orderedEntries(tickets.bySource).map(([key, value]) => ({ key, label: channelLabel(key), value }))}
            emptyText={empty}
          />
        </Panel>
        <Panel title="By priority">
          <BarList
            items={orderedEntries(tickets.byPriority, TICKET_PRIORITY_ORDER).map(([key, value]) => ({ key, label: formatEnum(key), value }))}
            emptyText={empty}
          />
        </Panel>
      </div>
    </section>
  );
}
