"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/**
 * Module 4: the shared header of the Analytics pages — tabs, date range and channel
 * filter. Filters live in the URL (shareable, and the server pages read them), and
 * are kept when switching tabs.
 */

const TABS = [
  { href: "/dashboard/analytics", label: "Overview" },
  { href: "/dashboard/analytics/reports", label: "Reports" },
  { href: "/dashboard/analytics/improve", label: "Improve" },
] as const;

const PRESETS = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
] as const;

const CHANNELS = [
  { value: "", label: "All channels" },
  { value: "WEB_WIDGET", label: "Website" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "SLACK", label: "Slack" },
  { value: "EMAIL", label: "Email" },
] as const;

type AnalyticsNavProps = {
  title: string;
  description: string;
  /** The range the server actually used (after validation). */
  range: { preset: string; from: string; to: string; channel: string | null; timeZone: string };
  actions?: React.ReactNode;
};

function dayValue(iso: string) {
  return iso.slice(0, 10);
}

export function AnalyticsNav({ title, description, range, actions }: AnalyticsNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [customOpen, setCustomOpen] = useState(range.preset === "custom");
  const [from, setFrom] = useState(dayValue(range.from));
  const [to, setTo] = useState(dayValue(range.to));
  const query = searchParams.toString();

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }

    const next = params.toString();
    router.push(next ? `${pathname}?${next}` : pathname);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">{title}</h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      <nav aria-label="Analytics sections" className="flex gap-1 border-b border-white/10">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={query ? `${tab.href}?${query}` : tab.href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                active ? "border-white text-white" : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Date range" className="inline-flex w-fit rounded-lg border border-white/10 bg-[#111111] p-1">
          {PRESETS.map((preset) => {
            const active = range.preset === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setCustomOpen(false);
                  navigate({ range: preset.value, from: null, to: null });
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  active ? "bg-white text-[#050505]" : "text-slate-300 hover:bg-white/5"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={range.preset === "custom"}
            aria-expanded={customOpen}
            onClick={() => setCustomOpen((open) => !open)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              range.preset === "custom" ? "bg-white text-[#050505]" : "text-slate-300 hover:bg-white/5"
            }`}
          >
            Custom
          </button>
        </div>

        {customOpen ? (
          <form
            className="flex flex-wrap items-center gap-2 text-sm text-slate-300"
            onSubmit={(event) => {
              event.preventDefault();
              if (from && to && from <= to) {
                navigate({ range: null, from, to });
              }
            }}
          >
            <label className="sr-only" htmlFor="analytics-from">From</label>
            <input
              id="analytics-from"
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              className="h-9 rounded-lg border border-white/10 bg-[#111111] px-2 text-slate-200"
            />
            <span className="text-slate-500">to</span>
            <label className="sr-only" htmlFor="analytics-to">To</label>
            <input
              id="analytics-to"
              type="date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
              className="h-9 rounded-lg border border-white/10 bg-[#111111] px-2 text-slate-200"
            />
            <button
              type="submit"
              disabled={!from || !to || from > to}
              className="h-9 rounded-lg border border-white/10 px-3 font-medium text-white hover:bg-white/5 disabled:opacity-50"
            >
              Apply
            </button>
          </form>
        ) : null}

        <label className="sr-only" htmlFor="analytics-channel">Channel</label>
        <select
          id="analytics-channel"
          value={range.channel ?? ""}
          onChange={(event) => navigate({ channel: event.target.value || null })}
          className="h-9 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-slate-200"
        >
          {CHANNELS.map((channel) => (
            <option key={channel.value} value={channel.value}>
              {channel.label}
            </option>
          ))}
        </select>

        <span className="text-xs text-slate-500">
          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: range.timeZone }).format(new Date(range.from))} –{" "}
          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: range.timeZone }).format(new Date(range.to))} · {range.timeZone}
        </span>
      </div>
    </div>
  );
}
