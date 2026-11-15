import { Skeleton } from "@/src/components/ui/skeleton";

export default function SetupLoading() {
  return (
    <div className="min-h-screen bg-[#050505] px-4 py-8 text-white md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading setup wizard...</span>

      {/* Top logo & user info */}
      <div className="mx-auto flex max-w-5xl items-center justify-between border-b border-white/10 pb-6">
        <Skeleton className="h-8 w-36 rounded-lg" />
        <Skeleton className="h-8 w-44 rounded-full" />
      </div>

      {/* Step indicator */}
      <div className="mx-auto mt-8 flex max-w-[860px] items-center justify-between gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-1 items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="hidden sm:block space-y-1">
              <Skeleton className="h-4 w-16 rounded" />
              <Skeleton className="h-3 w-20 rounded" />
            </div>
          </div>
        ))}
      </div>

      {/* Main wizard card */}
      <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 md:p-8 space-y-6">
        <div>
          <Skeleton className="h-7 w-48 rounded-lg" />
          <Skeleton className="mt-2 h-4 w-72 rounded" />
        </div>

        <div className="space-y-4">
          <div>
            <Skeleton className="h-4 w-28 rounded mb-2" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>

          <div>
            <Skeleton className="h-4 w-32 rounded mb-2" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        </div>

        <div className="flex justify-between items-center border-t border-white/5 pt-6">
          <Skeleton className="h-10 w-24 rounded-xl" />
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
