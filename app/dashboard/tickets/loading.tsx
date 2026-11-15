import {
  Skeleton,
  SkeletonHeader,
  SkeletonTable,
} from "@/src/components/ui/skeleton";

export default function TicketsLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading tickets...</span>
      <SkeletonHeader
        titleWidth="w-36"
        subtitleWidth="w-72"
        hasAction
      />

      {/* Filter and search bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-10 w-full sm:w-80 rounded-xl" />
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {["All", "Open", "Pending", "Closed"].map((status) => (
            <Skeleton key={status} className="h-9 w-20 rounded-lg" />
          ))}
        </div>
      </div>

      {/* Ticket rows skeleton */}
      <SkeletonTable rows={7} cols={5} />
    </div>
  );
}
