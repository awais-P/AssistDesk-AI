import Link from "next/link";
import { DashboardPageHeader } from "./dashboard-page-header";

type ResourceItem = {
  id: string;
  title: string;
  description: string;
  meta?: string;
  badges?: string[];
};

type WorkspaceResourceOverviewProps = {
  title: string;
  moduleLabel: string;
  description: string;
  items: ResourceItem[];
};

export function WorkspaceResourceOverview({
  title,
  moduleLabel,
  description,
  items,
}: WorkspaceResourceOverviewProps) {
  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <DashboardPageHeader title={title} />
        <Link
          href="/setup"
          className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
        >
          Open Setup Flow
        </Link>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[20px] border border-white/10 bg-[#0a0a0a] p-6">
          <p className="text-sm font-semibold text-slate-400">{moduleLabel}</p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
            {description}
          </p>

          <div className="mt-6 space-y-4">
            {items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-8 text-sm text-slate-400">
                No records have been created for this workspace yet.
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-lg font-semibold text-white">
                        {item.title}
                      </p>
                      {item.meta ? (
                        <p className="mt-1 text-sm text-slate-500">{item.meta}</p>
                      ) : null}
                    </div>
                    {item.badges?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {item.badges.map((badge) => (
                          <span
                            key={`${item.id}-${badge}`}
                            className="rounded-full border border-white/10 bg-[#151515] px-3 py-1 text-xs text-slate-300"
                          >
                            {badge}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    {item.description}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-[20px] border border-white/10 bg-[#0a0a0a] p-6">
          <p className="text-sm font-semibold text-slate-400">
            Workspace-scoped data
          </p>
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-sm font-medium text-white">
                User-based separation
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                These records are filtered by the logged-in workspace, so each
                registered user sees their own inboxes, agents, knowledge
                sources, chatbots, and tickets.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-sm font-medium text-white">How to edit</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Use the guided setup flow to create or update the initial
                records. This keeps the onboarding experience aligned with the
                mockups while still saving real database records.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
