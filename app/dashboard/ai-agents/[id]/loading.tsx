import { Skeleton } from "@/src/components/ui/skeleton";

export default function AgentDetailLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading agent details...</span>

      {/* Breadcrumb skeleton */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-20 rounded" />
        <span className="text-slate-600">/</span>
        <Skeleton className="h-4 w-32 rounded" />
      </div>

      {/* Agent Header banner */}
      <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-2xl" />
            <div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-7 w-48 rounded-lg" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <Skeleton className="mt-2 h-4 w-64 rounded" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-28 rounded-xl" />
            <Skeleton className="h-10 w-28 rounded-xl" />
          </div>
        </div>

        {/* Tab navigation bar skeleton */}
        <div className="mt-8 flex gap-2 overflow-x-auto border-t border-white/5 pt-4">
          {["Overview", "Sources", "Automations", "Actions", "Playground", "Settings"].map(
            (tab) => (
              <Skeleton key={tab} className="h-9 w-24 rounded-lg" />
            ),
          )}
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Metric cards */}
        <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 lg:col-span-1 space-y-6">
          <div>
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="mt-3 h-8 w-28 rounded-lg" />
            <Skeleton className="mt-2 h-3.5 w-48 rounded" />
          </div>
          <div className="border-t border-white/5 pt-6">
            <Skeleton className="h-4 w-28 rounded" />
            <Skeleton className="mt-3 h-8 w-32 rounded-lg" />
            <Skeleton className="mt-2 h-3.5 w-56 rounded" />
          </div>
        </div>

        {/* Configuration preview card */}
        <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 lg:col-span-2 space-y-4">
          <Skeleton className="h-5 w-44 rounded" />
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <div className="flex justify-end gap-3 pt-2">
            <Skeleton className="h-10 w-28 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
