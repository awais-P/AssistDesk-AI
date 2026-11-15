import {
  SkeletonHeader,
  SkeletonTable,
} from "@/src/components/ui/skeleton";

export default function UsersLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading team members...</span>
      <SkeletonHeader
        titleWidth="w-40"
        subtitleWidth="w-72"
        hasAction
      />

      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
