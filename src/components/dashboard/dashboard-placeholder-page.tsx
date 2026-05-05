import { DashboardPageHeader } from "./dashboard-page-header";

type DashboardPlaceholderPageProps = {
  title: string;
  description: string;
  moduleLabel: string;
};

export function DashboardPlaceholderPage({
  title,
  description,
  moduleLabel,
}: DashboardPlaceholderPageProps) {
  return (
    <div className="px-6 py-6 md:px-8">
      <DashboardPageHeader title={title} actionLabel="Create" />

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-[20px] border border-white/10 bg-[#0a0a0a] p-6">
          <p className="text-sm font-semibold text-slate-400">{moduleLabel}</p>
          <h2 className="heading-font mt-3 text-2xl font-semibold text-white">
            {title} skeleton screen
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400">
            {description}
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-sm font-medium text-white">
                UI shell ready
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                This section now exists inside the dashboard navigation so the
                product structure is visible during evaluation.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-sm font-medium text-white">
                Feature implementation pending
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                We can now fill this area with the detailed forms, tables, and
                workflows required by the related module.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[20px] border border-white/10 bg-[#0a0a0a] p-6">
          <p className="text-sm font-semibold text-slate-400">
            Planned work
          </p>
          <div className="mt-5 space-y-4">
            {[
              "Add real data source and API integration",
              "Implement form actions and validation",
              "Connect this screen to Prisma models later",
              "Match the final SRS mockup in more detail",
            ].map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-slate-300"
              >
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
