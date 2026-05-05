import { DashboardPageHeader } from "@/src/components/dashboard/dashboard-page-header";

export default function TicketsPage() {
  return (
    <div className="px-6 py-6 md:px-8">
      <DashboardPageHeader
        title="Tickets"
        actionLabel="Create Ticket"
        actionStyle="light"
      />

      <div className="mt-8 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-wrap gap-3">
          <input
            type="text"
            placeholder="Search..."
            className="min-w-[220px] rounded-xl border border-white/10 bg-[#0d0d0d] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
          />
          {["Priority", "Status", "State", "Assignee", "Inbox", "Tags"].map(
            (filter) => (
              <button
                key={filter}
                type="button"
                className="rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#181818]"
              >
                + {filter}
              </button>
            ),
          )}
        </div>

        <div className="flex flex-wrap gap-3 xl:justify-end">
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm font-medium text-white"
          >
            Filter
          </button>
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm font-medium text-white"
          >
            Grid
          </button>
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm font-medium text-white"
          >
            List
          </button>
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm font-medium text-white"
          >
            View
          </button>
        </div>
      </div>

      <section className="mt-6 rounded-[18px] border border-white/10 bg-[#080808]">
        <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 text-sm text-slate-300">
              <span className="h-4 w-4 rounded border border-white/20" />
              <span className="font-semibold text-white">#458103</span>
              <span className="rounded-lg border border-white/10 bg-[#111111] px-2 py-1 text-xs text-white">
                web
              </span>
            </div>

            <div className="mt-4 space-y-2">
              <h2 className="text-2xl font-semibold text-white">Hello</h2>
              <p className="text-base text-slate-400">Regarding Leave</p>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <span className="rounded-full bg-[#1f1f1f] px-3 py-1.5 text-sm font-medium text-white">
                Medium
              </span>
              <span className="rounded-full border border-[#22355b] bg-[#10192d] px-3 py-1.5 text-sm font-medium text-white">
                open
              </span>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1b1b1b] text-sm font-semibold text-white">
                A
              </span>
              <span className="text-sm text-slate-300">ahmad</span>
            </div>
          </div>

          <div className="flex min-w-[230px] flex-col items-start gap-20 text-sm lg:items-end">
            <button type="button" className="text-xl text-slate-400">
              ...
            </button>

            <div className="space-y-3 text-left lg:text-right">
              <p className="text-slate-400">Apr 04, 2026</p>
              <div className="flex items-center gap-3 lg:justify-end">
                <span className="text-slate-400">Assigned to:</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1f1f1f] text-xs font-semibold text-white">
                  MA
                </span>
                <span className="font-semibold text-white">Muhammad Awais</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-6 flex flex-col gap-5 text-sm text-slate-300 xl:flex-row xl:items-center xl:justify-between">
        <p>0 of 1 row(s) selected.</p>

        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <span>Rows per page</span>
            <div className="rounded-xl border border-white/10 bg-[#111111] px-4 py-2 text-white">
              20
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-medium text-white">Page 1 of 1</span>
            <div className="flex items-center gap-2">
              {["<<", "<", ">", ">>"].map((item) => (
                <button
                  key={item}
                  type="button"
                  className="rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-xs text-slate-300"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
