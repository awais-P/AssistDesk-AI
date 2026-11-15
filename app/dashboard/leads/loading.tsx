import {
  Skeleton,
  SkeletonHeader,
  SkeletonTable,
} from "@/src/components/ui/skeleton";

export default function LeadsLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading leads...</span>
      <SkeletonHeader
        titleWidth="w-32"
        subtitleWidth="w-72"
        hasAction
      />

      {/* Filter and stats row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-10 w-full sm:w-80 rounded-xl" />
        <div className="flex gap-2">
          {["All", "New", "Contacted", "Qualified"].map((status) => (
            <Skeleton key={status} className="h-9 w-20 rounded-lg" />
          ))}
        </div>
      </div>

      <SkeletonTable rows={7} cols={6} />
    </div>
  );
}
