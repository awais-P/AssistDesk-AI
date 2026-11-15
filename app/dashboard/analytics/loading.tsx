import {
  Skeleton,
  SkeletonHeader,
  SkeletonStatGrid,
} from "@/src/components/ui/skeleton";

export default function AnalyticsLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading analytics...</span>
      <SkeletonHeader
        titleWidth="w-40"
        subtitleWidth="w-72"
        hasAction
      />

      {/* Date range filter skeleton */}
      <div className="flex gap-2">
        {["7 Days", "30 Days", "90 Days"].map((range) => (
          <Skeleton key={range} className="h-9 w-20 rounded-lg" />
        ))}
      </div>

      <SkeletonStatGrid count={4} />

      {/* Analytics Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 space-y-4">
          <Skeleton className="h-5 w-44 rounded" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 space-y-4">
          <Skeleton className="h-5 w-48 rounded" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
