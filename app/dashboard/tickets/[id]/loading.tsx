import { Skeleton } from "@/src/components/ui/skeleton";

export default function TicketDetailLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading ticket details...</span>

      {/* Breadcrumb skeleton */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-16 rounded" />
        <span className="text-slate-600">/</span>
        <Skeleton className="h-4 w-48 rounded" />
      </div>

      {/* Main split grid: messages on left, metadata on right */}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left: Ticket thread */}
        <div className="space-y-4 rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
          <div className="flex items-start justify-between border-b border-white/5 pb-4">
            <div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-6 w-60 rounded-md" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <Skeleton className="mt-2 h-4 w-40 rounded" />
            </div>
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>

          {/* Simulated chat thread message bubbles */}
          <div className="space-y-4 py-4">
            <div className="flex gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="space-y-2 max-w-md">
                <Skeleton className="h-3.5 w-24 rounded" />
                <Skeleton className="h-20 w-80 rounded-2xl" />
              </div>
            </div>

            <div className="flex flex-row-reverse gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="space-y-2 max-w-md items-end">
                <Skeleton className="h-3.5 w-24 rounded ml-auto" />
                <Skeleton className="h-28 w-96 rounded-2xl" />
              </div>
            </div>
          </div>

          {/* Reply composer skeleton */}
          <div className="border-t border-white/5 pt-4">
            <Skeleton className="h-28 w-full rounded-xl" />
            <div className="mt-3 flex justify-between items-center">
              <Skeleton className="h-8 w-24 rounded-lg" />
              <Skeleton className="h-10 w-28 rounded-xl" />
            </div>
          </div>
        </div>

        {/* Right: Sidebar metadata */}
        <div className="space-y-6 rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 h-fit">
          <div className="space-y-3">
            <Skeleton className="h-4 w-28 rounded" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
          <div className="border-t border-white/5 pt-4 space-y-2">
            <Skeleton className="h-4 w-36 rounded" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-4/5 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
