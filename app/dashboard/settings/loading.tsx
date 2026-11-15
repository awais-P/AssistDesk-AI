import {
  Skeleton,
  SkeletonHeader,
} from "@/src/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8 max-w-4xl" role="status" aria-live="polite">
      <span className="sr-only">Loading workspace settings...</span>
      <SkeletonHeader
        titleWidth="w-52"
        subtitleWidth="w-80"
      />

      <div className="space-y-6">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 space-y-4">
            <div>
              <Skeleton className="h-5 w-40 rounded" />
              <Skeleton className="mt-1 h-3.5 w-64 rounded" />
            </div>
            <div className="space-y-3 pt-2">
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
            <div className="flex justify-end pt-2">
              <Skeleton className="h-10 w-28 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
