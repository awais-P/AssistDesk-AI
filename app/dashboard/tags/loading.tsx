import {
  Skeleton,
  SkeletonHeader,
  SkeletonTable,
} from "@/src/components/ui/skeleton";

export default function TagsLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading tags...</span>
      <SkeletonHeader
        titleWidth="w-24"
        subtitleWidth="w-64"
        hasAction
      />

      <SkeletonTable rows={6} cols={4} />
    </div>
  );
}
