type ReportsWorkspaceProps = {
  metrics: {
    totalTickets: number;
    openTickets: number;
    handledByAgents: number;
    activeAgents: number;
    sourceBreakdown: Record<string, number>;
    handledByAgent: Record<string, number>;
  };
};

function ReportCard({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/8 text-white">
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M5 12h14" />
          <path d="M8 8v8" />
          <path d="M16 8v8" />
        </svg>
      </div>
      <p className="mt-5 text-[2rem] font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm text-slate-400">{description}</p>
      <p className="mt-6 text-sm font-medium text-slate-300">{value}</p>
    </div>
  );
}

export function ReportsWorkspace({ metrics }: ReportsWorkspaceProps) {
  const topAgent = Object.entries(metrics.handledByAgent).sort(
    (first, second) => second[1] - first[1],
  )[0];

  const topSource = Object.entries(metrics.sourceBreakdown).sort(
    (first, second) => second[1] - first[1],
  )[0];

  return (
    <div className="px-5 py-4 md:px-6">
      <div>
        <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
          Reports
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-400">
          View your ticket handling and agent reports in real-time.
        </p>
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-3">
        <ReportCard
          title="New Tickets"
          description="New tickets received, solved and handling time"
          value={`${metrics.totalTickets} total, ${metrics.openTickets} currently open`}
        />
        <ReportCard
          title="Tickets Handled by Agent"
          description="Tickets handled by each agent, including new and resolved workload."
          value={
            topAgent
              ? `${topAgent[0]} is leading with ${topAgent[1]} handled tickets`
              : `${metrics.handledByAgents} tickets assigned so far`
          }
        />
        <ReportCard
          title="Source Breakdown"
          description="Distribution of tickets by source channel"
          value={
            topSource
              ? `${topSource[0]} is the top source with ${topSource[1]} tickets`
              : "No ticket sources available yet"
          }
        />
        <ReportCard
          title="Resolution Time"
          description="Average time to resolve tickets over time"
          value="Using current sample data: 4h 20m average handling window"
        />
        <ReportCard
          title="First Response Time"
          description="Average time to first response on tickets"
          value="Current dashboard estimate: 18m"
        />
        <ReportCard
          title="Active Team Coverage"
          description="Monitor how many agents are currently available in your workspace"
          value={`${metrics.activeAgents} staff accounts available for assignment`}
        />
      </div>
    </div>
  );
}
