import {
  Skeleton,
  SkeletonHeader,
  SkeletonCard,
} from "@/src/components/ui/skeleton";

export default function PromptsLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading prompt templates...</span>
      <SkeletonHeader
        titleWidth="w-48"
        subtitleWidth="w-72"
        hasAction
      />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i}>
            <div className="flex items-start justify-between">
              <Skeleton className="h-5 w-40 rounded" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-5/6 rounded" />
              <Skeleton className="h-4 w-3/4 rounded" />
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4">
              <Skeleton className="h-3.5 w-20 rounded" />
              <Skeleton className="h-8 w-16 rounded-lg" />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}
