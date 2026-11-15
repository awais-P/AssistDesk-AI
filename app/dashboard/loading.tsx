import {
  Skeleton,
  SkeletonHeader,
  SkeletonStatGrid,
} from "@/src/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading dashboard...</span>
      <SkeletonHeader
        titleWidth="w-56"
        subtitleWidth="w-96"
        hasAction
      />

      <SkeletonStatGrid count={4} />

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
          <div className="flex items-center justify-between mb-6">
            <Skeleton className="h-5 w-40 rounded" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
          <Skeleton className="h-5 w-32 rounded mb-6" />
          <div className="space-y-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-44 rounded" />
                  <Skeleton className="h-3 w-28 rounded" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
