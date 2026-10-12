"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  RelativeTime,
  isInternalLink,
  severityDotClass,
  severityLabel,
  type DashboardNotification,
} from "./notifications-bell";

export type OverviewAgentRow = {
  /** null groups replies from deleted or unassigned agents. */
  id: string | null;
  name: string;
  status: string | null;
  replies: number;
  avgLatencyMs: number | null;
  fallbackRate: number | null;
  tokens: number;
};

type OverviewWorkspaceProps = {
  rangeDays: 7 | 30;
  firstName: string;
  kpis: {
    aiReplies: number;
    avgResponseMs: number | null;
    fallbackRate: number | null;
    tokens: number;
    openTickets: number;
    activeChats: number;
    waitingChats: number;
    teamOnline: number;
    teamSize: number;
    leadsCaptured: number;
    leadsHot: number;
  };
  agents: OverviewAgentRow[];
  knowledge: {
    synced: number;
    queued: number;
    failed: number;
    warnings: number;
  };
  alerts: DashboardNotification[];
  unreadAlerts: number;
};

/** Fallback rates at or above this are flagged, since the KB answered instead of the AI. */
const HIGH_FALLBACK_RATE = 0.3;

const numberFormatter = new Intl.NumberFormat("en-US");

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatSeconds(ms: number | null) {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

function formatPercent(rate: number | null) {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

const agentStatusClass: Record<string, string> = {
  ACTIVE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  DRAFT: "border-white/10 bg-white/5 text-slate-300",
  ARCHIVED: "border-amber-500/30 bg-amber-500/10 text-amber-200",
};

function KpiCard({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  href?: string;
  tone?: "default" | "warning";
}) {
  const content = (
    <>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p
        className={`mt-2 text-[1.75rem] font-semibold leading-none ${
          tone === "warning" ? "text-amber-200" : "text-white"
        }`}
      >
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p>
    </>
  );
  const className = `block rounded-xl border bg-[#0a0a0a] p-4 ${
    tone === "warning" ? "border-amber-500/30" : "border-white/10"
  }`;

  if (href) {
    return (
      <Link href={href} className={`pressable ${className} transition hover:bg-[#111111]`}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const quickActions = [
  {
    href: "/dashboard/ai-agents",
    label: "New agent",
    description: "Create and configure an AI assistant.",
  },
  {
    href: "/dashboard/knowledge-base",
    label: "Add knowledge",
    description: "Upload files, crawl a URL or paste text.",
  },
  {
    href: "/dashboard/chatbots",
    label: "Embed chatbot",
    description: "Get the widget snippet for your website.",
  },
  {
    href: "/dashboard/chats",
    label: "Open chats",
    description: "Reply to live and escalated conversations.",
  },
];

export function OverviewWorkspace({
  rangeDays,
  firstName,
  kpis,
  agents,
  knowledge,
  alerts,
  unreadAlerts,
}: OverviewWorkspaceProps) {
  const rangeLabel = `last ${rangeDays} days`;
  const highFallback = kpis.fallbackRate !== null && kpis.fallbackRate >= HIGH_FALLBACK_RATE;

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
            Overview
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Welcome back, {firstName}. Here&apos;s how your assistants and team performed
            over the {rangeLabel}.
          </p>
        </div>

        <nav
          aria-label="Date range"
          className="inline-flex w-fit rounded-lg border border-white/10 bg-[#111111] p-1"
        >
          {([7, 30] as const).map((days) => {
            const isActive = days === rangeDays;

            return (
              <Link
                key={days}
                href={days === 7 ? "/dashboard" : `/dashboard?range=${days}`}
                aria-current={isActive ? "page" : undefined}
                scroll={false}
                className={`pressable rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  isActive ? "bg-white text-[#050505]" : "text-slate-300 hover:bg-white/5"
                }`}
              >
                {days} days
              </Link>
            );
          })}
        </nav>
      </div>

      <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs leading-5 text-slate-400">
        This is a quick summary. Deeper analytics (trends, channels, CSAT and exports)
        live in{" "}
        <Link href="/dashboard/reports" className="font-semibold text-white hover:underline">
          Reports
        </Link>
        .{" "}
        <Link href="/dashboard/analytics" className="font-semibold text-white hover:underline">
          View analytics &rarr;
        </Link>
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="AI replies"
          value={formatNumber(kpis.aiReplies)}
          hint={`Customer-facing replies in the ${rangeLabel} (playground tests excluded).`}
          href="/dashboard/logs"
        />
        <KpiCard
          label="Avg AI response time"
          value={formatSeconds(kpis.avgResponseMs)}
          hint="Average time to generate each reply."
        />
        <KpiCard
          label="Knowledge-base fallback rate"
          value={formatPercent(kpis.fallbackRate)}
          hint={
            highFallback
              ? "High: the AI model often failed and the KB answered instead. Check the agent's model and API key."
              : "Share of replies answered from the knowledge base because the AI model was unavailable."
          }
          tone={highFallback ? "warning" : "default"}
        />
        <KpiCard
          label="Tokens used"
          value={formatNumber(kpis.tokens)}
          hint={`LLM tokens consumed by AI replies in the ${rangeLabel}.`}
        />
        <KpiCard
          label="Open tickets"
          value={formatNumber(kpis.openTickets)}
          hint="Tickets that are open or in progress."
          href="/dashboard/tickets"
        />
        <KpiCard
          label="Active chats"
          value={formatNumber(kpis.activeChats)}
          hint="Conversations with activity in the last 24 hours."
          href="/dashboard/chats"
        />
        <KpiCard
          label="Waiting for a human"
          value={formatNumber(kpis.waitingChats)}
          hint={
            kpis.waitingChats > 0
              ? "Escalated chats need a team member. Open Chats to take over."
              : "No escalated chats right now."
          }
          href="/dashboard/chats"
          tone={kpis.waitingChats > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Team online now"
          value={`${formatNumber(kpis.teamOnline)} / ${formatNumber(kpis.teamSize)}`}
          hint="Members active on the dashboard in the last 2 minutes."
          href="/dashboard/users"
        />
        <KpiCard
          label="Leads captured"
          value={formatNumber(kpis.leadsCaptured)}
          hint={
            kpis.leadsCaptured > 0
              ? `New leads in the ${rangeLabel}, ${formatNumber(kpis.leadsHot)} of them hot (score 70+).`
              : `No new leads in the ${rangeLabel}. Turn on the lead form in Chatbots to start capturing them.`
          }
          href="/dashboard/leads"
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-5">
          <SectionCard
            title="Assistant performance"
            description={`Per-agent AI replies in the ${rangeLabel}.`}
            action={
              <Link
                href="/dashboard/ai-agents"
                className="text-xs font-semibold text-slate-300 hover:text-white"
              >
                All agents &rarr;
              </Link>
            }
          >
            {agents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
                <p className="text-sm font-medium text-white">No AI agents yet</p>
                <p className="mt-1 text-xs text-slate-400">
                  Create an agent to start answering chats and tickets automatically.
                </p>
                <Link
                  href="/dashboard/ai-agents"
                  className="pressable mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-white px-4 text-xs font-semibold text-[#050505] transition hover:bg-neutral-200"
                >
                  Create an agent
                </Link>
              </div>
            ) : (
              <div className="-mx-5 overflow-x-auto px-5">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-xs text-slate-400">
                      <th scope="col" className="py-2 pr-3 font-medium">Agent</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Replies</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Avg latency</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Fallback</th>
                      <th scope="col" className="py-2 pl-3 text-right font-medium">Tokens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {agents.map((agent) => {
                      const fallbackIsHigh =
                        agent.fallbackRate !== null && agent.fallbackRate >= HIGH_FALLBACK_RATE;

                      return (
                        <tr key={agent.id ?? "unassigned"}>
                          <td className="py-2.5 pr-3">
                            <div className="flex min-w-0 items-center gap-2">
                              {agent.id ? (
                                <Link
                                  href={`/dashboard/ai-agents/${agent.id}`}
                                  className="truncate font-medium text-white hover:underline"
                                >
                                  {agent.name}
                                </Link>
                              ) : (
                                <span className="truncate text-slate-400">{agent.name}</span>
                              )}
                              {agent.status ? (
                                <span
                                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                    agentStatusClass[agent.status] ?? agentStatusClass.DRAFT
                                  }`}
                                >
                                  {agent.status.charAt(0)}
                                  {agent.status.slice(1).toLowerCase()}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-200">
                            {formatNumber(agent.replies)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-200">
                            {formatSeconds(agent.avgLatencyMs)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right ${
                              fallbackIsHigh ? "text-amber-200" : "text-slate-200"
                            }`}
                          >
                            {formatPercent(agent.fallbackRate)}
                          </td>
                          <td className="py-2.5 pl-3 text-right text-slate-200">
                            {formatNumber(agent.tokens)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Recent alerts"
            description={
              unreadAlerts > 0
                ? `${unreadAlerts} unread. Use the bell to mark them as read.`
                : "System notifications for your workspace."
            }
          >
            {alerts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
                <p className="text-sm font-medium text-white">No alerts yet</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  New chats, escalations, knowledge-base failures and integration
                  errors will appear here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-white/5">
                {alerts.map((alert) => {
                  const body = (
                    <>
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityDotClass[alert.severity]}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="sr-only">{severityLabel[alert.severity]}: </span>
                        <span
                          className={`block text-sm ${
                            alert.read ? "text-slate-300" : "font-semibold text-white"
                          }`}
                        >
                          {alert.title}
                        </span>
                        {alert.body ? (
                          <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-slate-400">
                            {alert.body}
                          </span>
                        ) : null}
                      </span>
                      <RelativeTime
                        value={alert.createdAt}
                        className="shrink-0 pt-0.5 text-[11px] text-slate-500"
                      />
                    </>
                  );

                  return (
                    <li key={alert.id}>
                      {isInternalLink(alert.link) ? (
                        <Link
                          href={alert.link}
                          className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 transition hover:bg-white/5"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-start gap-3 py-2.5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="min-w-0 space-y-5">
          <SectionCard
            title="Knowledge health"
            description="Status of the sources your agents answer from."
            action={
              <Link
                href="/dashboard/knowledge-base"
                className="text-xs font-semibold text-slate-300 hover:text-white"
              >
                Knowledge base &rarr;
              </Link>
            }
          >
            <dl className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <dt className="text-[11px] text-slate-400">Synced</dt>
                <dd className="mt-1 text-xl font-semibold text-emerald-200">
                  {formatNumber(knowledge.synced)}
                </dd>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <dt className="text-[11px] text-slate-400">Queued</dt>
                <dd className="mt-1 text-xl font-semibold text-sky-200">
                  {formatNumber(knowledge.queued)}
                </dd>
              </div>
              <div
                className={`rounded-xl border p-3 ${
                  knowledge.failed > 0
                    ? "border-red-500/30 bg-red-500/10"
                    : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <dt className="text-[11px] text-slate-400">Failed</dt>
                <dd
                  className={`mt-1 text-xl font-semibold ${
                    knowledge.failed > 0 ? "text-red-200" : "text-white"
                  }`}
                >
                  {formatNumber(knowledge.failed)}
                </dd>
              </div>
            </dl>
            {knowledge.failed > 0 ? (
              <p className="mt-3 text-xs leading-5 text-red-200">
                {knowledge.failed === 1 ? "1 source" : `${knowledge.failed} sources`} failed
                to process. Open the knowledge base to see the error and retry.
              </p>
            ) : null}
            {knowledge.warnings > 0 ? (
              <p className="mt-3 text-xs leading-5 text-amber-200">
                {knowledge.warnings === 1 ? "1 synced source uses" : `${knowledge.warnings} synced sources use`}{" "}
                keyword search only because embeddings were unavailable.
              </p>
            ) : null}
            {knowledge.synced + knowledge.queued + knowledge.failed === 0 ? (
              <p className="mt-3 text-xs leading-5 text-slate-400">
                No knowledge sources yet. Add files, a website or text so your agents can
                answer from your own content.
              </p>
            ) : null}
          </SectionCard>

          <SectionCard title="Quick actions">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {quickActions.map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className="pressable flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#111111] px-4 py-3 transition hover:bg-[#1a1a1a]"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">
                      {action.label}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {action.description}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-slate-500">
                    &rarr;
                  </span>
                </Link>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
