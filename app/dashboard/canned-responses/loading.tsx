import {
  Skeleton,
  SkeletonHeader,
  SkeletonTable,
} from "@/src/components/ui/skeleton";

export default function CannedResponsesLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading canned responses...</span>
      <SkeletonHeader
        titleWidth="w-52"
        subtitleWidth="w-80"
        hasAction
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-10 w-full sm:w-80 rounded-xl" />
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>

      <SkeletonTable rows={7} cols={4} />
    </div>
  );
}
