import {
  Skeleton,
  SkeletonHeader,
  SkeletonStatGrid,
  SkeletonTable,
} from "@/src/components/ui/skeleton";

export default function EscalationsLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading escalations...</span>
      <SkeletonHeader
        titleWidth="w-48"
        subtitleWidth="w-80"
        hasAction
      />

      <SkeletonStatGrid count={3} />

      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
