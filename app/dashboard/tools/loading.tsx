import {
  Skeleton,
  SkeletonHeader,
  SkeletonCard,
} from "@/src/components/ui/skeleton";

export default function ToolsLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading AI agent tools...</span>
      <SkeletonHeader
        titleWidth="w-48"
        subtitleWidth="w-80"
        hasAction
      />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <div>
                  <Skeleton className="h-5 w-32 rounded" />
                  <Skeleton className="mt-1 h-3.5 w-20 rounded" />
                </div>
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>

            <div className="mt-4 space-y-2">
              <Skeleton className="h-3.5 w-full rounded" />
              <Skeleton className="h-3.5 w-3/4 rounded" />
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4">
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}
