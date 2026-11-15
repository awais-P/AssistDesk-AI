import {
  Skeleton,
  SkeletonHeader,
  SkeletonTable,
} from "@/src/components/ui/skeleton";

export default function LogsLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading audit and action logs...</span>
      <SkeletonHeader
        titleWidth="w-36"
        subtitleWidth="w-64"
      />

      {/* Filter row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-10 w-full sm:w-72 rounded-xl" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 w-28 rounded-xl" />
          <Skeleton className="h-10 w-28 rounded-xl" />
        </div>
      </div>

      <SkeletonTable rows={8} cols={6} />
    </div>
  );
}
