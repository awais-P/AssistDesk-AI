import {
  Skeleton,
  SkeletonHeader,
  SkeletonStatGrid,
} from "@/src/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading reports...</span>
      <SkeletonHeader
        titleWidth="w-36"
        subtitleWidth="w-72"
        hasAction
      />

      <SkeletonStatGrid count={4} />

      <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 space-y-4">
        <Skeleton className="h-5 w-40 rounded" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  );
}
