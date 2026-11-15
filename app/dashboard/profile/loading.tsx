import {
  Skeleton,
  SkeletonHeader,
} from "@/src/components/ui/skeleton";

export default function ProfileLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8 max-w-3xl" role="status" aria-live="polite">
      <span className="sr-only">Loading user profile...</span>
      <SkeletonHeader
        titleWidth="w-36"
        subtitleWidth="w-64"
      />

      <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-20 w-20 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40 rounded" />
            <Skeleton className="h-4 w-52 rounded" />
          </div>
        </div>

        <div className="space-y-4 border-t border-white/5 pt-6">
          <div>
            <Skeleton className="h-4 w-24 rounded mb-2" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
          <div>
            <Skeleton className="h-4 w-28 rounded mb-2" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
