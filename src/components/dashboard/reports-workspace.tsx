import Link from "next/link";

export type ReportRange = 7 | 30 | 90;

type ReportsWorkspaceProps = {
  range: ReportRange;
  ranges: ReportRange[];
  tickets: {
    total: number;
    sampled: number | null;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    bySource: Record<string, number>;
    avgFirstResponseMs: number | null;
    respondedCount: number;
    avgResolutionMs: number | null;
    resolvedCount: number;
    aiResolvedRate: number | null;
    aiResolvedCount: number;
    unassignedCount: number;
    topAgents: Array<{ name: string; handled: number; resolved: number }>;
  };
  chats: {
    total: number;
    sampled: number | null;
    byChannel: Record<string, number>;
    escalatedCount: number;
    messagesBySender: Record<string, number>;
  };
  ai: {
    replyCount: number;
    avgDurationMs: number | null;
    fallbackRate: number | null;
    fallbackCount: number;
    totalTokens: number;
    byAction: Record<string, number>;
  };
};

const statusOrder = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const priorityOrder = ["URGENT", "HIGH", "MEDIUM", "LOW"];
const senderLabels: Record<string, string> = {
  USER: "Customers",
  AI: "AI",
  AGENT: "Agents",
};
const channelLabels: Record<string, string> = {
  WEB_WIDGET: "Web widget",
  WHATSAPP: "WhatsApp",
  SLACK: "Slack",
  VOICE: "Voice",
  EMAIL: "Email",
};

function formatLabel(value: string) {
  const text = value.toLowerCase().replace(/_/g, " ");

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDuration(ms: number | null) {
  if (ms === null) {
    return "—";
  }

  const totalMinutes = Math.round(ms / 60000);

  if (ms < 60000) {
    return `${Math.max(1, Math.round(ms / 1000))}s`;
  }

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);

  if (totalHours < 24) {
    return `${totalHours}h ${totalMinutes % 60}m`;
  }

  return `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`;
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

function toOrderedEntries(record: Record<string, number>, order?: string[]) {
  const entries = Object.entries(record);

  if (!order) {
    return entries.sort((first, second) => second[1] - first[1]);
  }

  const rank = (key: string) => {
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };

  return entries.sort((first, second) => rank(first[0]) - rank(second[0]));
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-3 text-[2rem] font-semibold leading-none text-white">{value}</p>
      <p className="mt-3 text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function BarList({
  items,
  emptyText,
}: {
  items: Array<{ label: string; value: number; hint?: string }>;
  emptyText: string;
}) {
  const nonEmpty = items.filter((item) => item.value > 0);

  if (nonEmpty.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">{emptyText}</p>;
  }

  const max = Math.max(...nonEmpty.map((item) => item.value));
  const total = nonEmpty.reduce((sum, item) => sum + item.value, 0);

  return (
    <ul className="space-y-3">
      {nonEmpty.map((item) => {
        const share = Math.round((item.value / total) * 100);

        return (
          <li key={item.label}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-slate-200">{item.label}</span>
              <span className="shrink-0 tabular-nums text-slate-400">
                {formatNumber(item.value)}
                {item.hint ? ` · ${item.hint}` : ` · ${share}%`}
              </span>
            </div>
            <div
              className="mt-1.5 h-2 rounded-full bg-white/5"
              role="presentation"
            >
              <div
                className="h-2 rounded-full bg-white/70"
                style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
      <h3 className="text-base font-semibold text-white">{title}</h3>
      {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function ReportsWorkspace({ range, ranges, tickets, chats, ai }: ReportsWorkspaceProps) {
  const hasAnyData = tickets.total > 0 || chats.total > 0 || ai.replyCount > 0;

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
            Reports
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Ticket, chat and AI activity for the last {range} days, calculated from
            your workspace data.
          </p>
        </div>

        <nav
          aria-label="Report date range"
          className="inline-flex w-fit rounded-lg border border-white/10 bg-[#111111] p-1"
        >
          {ranges.map((option) => (
            <Link
              key={option}
              href={`/dashboard/reports?range=${option}`}
              aria-current={option === range ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                option === range
                  ? "bg-white text-[#050505]"
                  : "text-slate-300 hover:bg-white/5"
              }`}
            >
              {option} days
            </Link>
          ))}
        </nav>
      </div>

      <p className="mt-5 rounded-xl border border-white/10 bg-[#0a0a0a] px-4 py-3 text-sm text-slate-400">
        Detailed analytics and charts are part of Module 4 (Monitoring &amp; Analytics).
      </p>

      {!hasAnyData ? (
        <div className="mt-6 flex min-h-[260px] flex-col items-center justify-center rounded-[22px] border border-white/10 bg-[#0a0a0a] px-6 py-16 text-center">
          <svg
            viewBox="0 0 24 24"
            className="h-10 w-10 text-slate-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M4 20V10" />
            <path d="M10 20V4" />
            <path d="M16 20v-7" />
            <path d="M22 20H2" />
          </svg>
          <p className="mt-4 text-xl text-slate-300">No activity in the last {range} days</p>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            Reports fill in as tickets, chats and AI replies come in. Try a longer
            date range, or connect a channel from Integrations to start receiving
            conversations.
          </p>
        </div>
      ) : (
        <>
          <h2 className="mt-8 text-lg font-semibold text-white">Tickets</h2>
          {tickets.sampled !== null ? (
            <p className="mt-1 text-sm text-amber-200/80">
              Breakdowns and timings use the latest {formatNumber(tickets.sampled)} tickets
              in this range.
            </p>
          ) : null}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="New tickets"
              value={formatNumber(tickets.total)}
              detail={`${formatNumber(tickets.byStatus.OPEN ?? 0)} still open`}
            />
            <StatCard
              label="Avg. first response"
              value={formatDuration(tickets.avgFirstResponseMs)}
              detail={
                tickets.respondedCount > 0
                  ? `Across ${formatNumber(tickets.respondedCount)} tickets with a reply (AI or agent)`
                  : "No tickets have been answered yet"
              }
            />
            <StatCard
              label="Avg. resolution time (approx.)"
              value={formatDuration(tickets.avgResolutionMs)}
              detail={
                tickets.resolvedCount > 0
                  ? `Created to last update, ${formatNumber(tickets.resolvedCount)} resolved/closed tickets`
                  : "No resolved or closed tickets yet"
              }
            />
            <StatCard
              label="AI-resolved rate"
              value={formatPercent(tickets.aiResolvedRate)}
              detail={
                tickets.aiResolvedRate !== null
                  ? `${formatNumber(tickets.aiResolvedCount)} of ${formatNumber(tickets.respondedCount)} replied tickets answered only by AI`
                  : "No replied tickets yet"
              }
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Panel title="By status">
              <BarList
                items={toOrderedEntries(tickets.byStatus, statusOrder).map(([key, value]) => ({
                  label: formatLabel(key),
                  value,
                }))}
                emptyText="No tickets in this range."
              />
            </Panel>
            <Panel title="By priority">
              <BarList
                items={toOrderedEntries(tickets.byPriority, priorityOrder).map(([key, value]) => ({
                  label: formatLabel(key),
                  value,
                }))}
                emptyText="No tickets in this range."
              />
            </Panel>
            <Panel title="By channel">
              <BarList
                items={toOrderedEntries(tickets.bySource).map(([key, value]) => ({
                  label: formatLabel(key),
                  value,
                }))}
                emptyText="No tickets in this range."
              />
            </Panel>
          </div>

          <div className="mt-4">
            <Panel
              title="Top agents by handled tickets"
              description={
                tickets.unassignedCount > 0
                  ? `${formatNumber(tickets.unassignedCount)} unassigned ticket(s) are not counted.`
                  : "Tickets assigned to each team member in this range."
              }
            >
              <BarList
                items={tickets.topAgents.map((agent) => ({
                  label: agent.name,
                  value: agent.handled,
                  hint: `${formatNumber(agent.resolved)} resolved`,
                }))}
                emptyText="No tickets have been assigned to a team member in this range."
              />
            </Panel>
          </div>

          <h2 className="mt-8 text-lg font-semibold text-white">Chats</h2>
          {chats.sampled !== null ? (
            <p className="mt-1 text-sm text-amber-200/80">
              Breakdowns use the latest {formatNumber(chats.sampled)} chat sessions in this range.
            </p>
          ) : null}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Chat sessions"
              value={formatNumber(chats.total)}
              detail="Started in this range"
            />
            <StatCard
              label="Escalated to a human"
              value={formatNumber(chats.escalatedCount)}
              detail={
                chats.total > 0
                  ? `${formatPercent(chats.escalatedCount / chats.total)} of sessions are currently escalated`
                  : "No chat sessions yet"
              }
            />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel title="Sessions by channel">
              <BarList
                items={toOrderedEntries(chats.byChannel).map(([key, value]) => ({
                  label: channelLabels[key] ?? formatLabel(key),
                  value,
                }))}
                emptyText="No chat sessions in this range."
              />
            </Panel>
            <Panel title="Messages by sender">
              <BarList
                items={["USER", "AI", "AGENT"].map((key) => ({
                  label: senderLabels[key],
                  value: chats.messagesBySender[key] ?? 0,
                }))}
                emptyText="No chat messages in this range."
              />
            </Panel>
          </div>

          <h2 className="mt-8 text-lg font-semibold text-white">AI replies</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="AI replies"
              value={formatNumber(ai.replyCount)}
              detail="Chatbot, Slack, WhatsApp, ticket and playground replies"
            />
            <StatCard
              label="Avg. reply time"
              value={
                ai.avgDurationMs === null
                  ? "—"
                  : ai.avgDurationMs < 1000
                    ? `${Math.round(ai.avgDurationMs)} ms`
                    : `${(ai.avgDurationMs / 1000).toFixed(1)} s`
              }
              detail="Time taken by the AI model to answer"
            />
            <StatCard
              label="Fallback rate"
              value={formatPercent(ai.fallbackRate)}
              detail={
                ai.replyCount > 0
                  ? `${formatNumber(ai.fallbackCount)} replies used the fallback answer`
                  : "No AI replies yet"
              }
            />
            <StatCard
              label="Tokens used"
              value={formatNumber(ai.totalTokens)}
              detail="Total across all AI replies"
            />
          </div>
          <div className="mt-4">
            <Panel title="Replies by type">
              <BarList
                items={toOrderedEntries(ai.byAction).map(([key, value]) => ({
                  label: formatLabel(key),
                  value,
                }))}
                emptyText="No AI replies in this range."
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
