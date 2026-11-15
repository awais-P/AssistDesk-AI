import {
  Skeleton,
  SkeletonHeader,
  SkeletonCard,
} from "@/src/components/ui/skeleton";

export default function AIAgentsLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading AI agents...</span>
      <SkeletonHeader
        titleWidth="w-48"
        subtitleWidth="w-80"
        hasAction
      />

      {/* Filter / search bar skeleton */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-10 w-full sm:w-72 rounded-xl" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 w-28 rounded-xl" />
          <Skeleton className="h-10 w-28 rounded-xl" />
        </div>
      </div>

      {/* Grid of Agent cards */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <div>
                  <Skeleton className="h-5 w-32 rounded" />
                  <Skeleton className="mt-1.5 h-3.5 w-24 rounded" />
                </div>
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>

            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-3/4 rounded" />
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-16 rounded" />
                <Skeleton className="h-4 w-20 rounded" />
              </div>
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}
