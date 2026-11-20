import { Skeleton, SkeletonHeader } from "@/src/components/ui/skeleton";

export default function RefundsLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading refunds...</span>
      <SkeletonHeader titleWidth="w-40" subtitleWidth="w-80" />

      <div className="flex gap-2 border-b border-white/5 pb-4">
        {["Waiting", "Decided", "All"].map((tab) => (
          <Skeleton key={tab} className="h-9 w-24 rounded-lg" />
        ))}
      </div>

      <div className="space-y-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
