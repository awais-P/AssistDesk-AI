import {
  Skeleton,
  SkeletonHeader,
  SkeletonCard,
} from "@/src/components/ui/skeleton";

export default function KnowledgeBaseLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading knowledge base...</span>
      <SkeletonHeader
        titleWidth="w-52"
        subtitleWidth="w-80"
        hasAction
      />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/5 pb-4">
        {["Sources", "Documents", "Websites"].map((tab) => (
          <Skeleton key={tab} className="h-9 w-24 rounded-lg" />
        ))}
      </div>

      {/* Source Cards */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <div>
                  <Skeleton className="h-5 w-36 rounded" />
                  <Skeleton className="mt-1.5 h-3.5 w-20 rounded" />
                </div>
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <div className="mt-4 space-y-2">
              <Skeleton className="h-3.5 w-full rounded" />
              <Skeleton className="h-3.5 w-3/4 rounded" />
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4">
              <Skeleton className="h-3 w-28 rounded" />
              <Skeleton className="h-8 w-16 rounded-lg" />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}
