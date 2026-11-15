import { Skeleton } from "@/src/components/ui/skeleton";

export default function ContactDetailLoading() {
  return (
    <div className="space-y-6 px-5 py-6 md:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading customer profile...</span>

      {/* Breadcrumb skeleton */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-20 rounded" />
        <span className="text-slate-600">/</span>
        <Skeleton className="h-4 w-40 rounded" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Left Customer Card */}
        <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 space-y-6 h-fit">
          <div className="text-center space-y-3">
            <Skeleton className="h-20 w-20 rounded-full mx-auto" />
            <Skeleton className="h-6 w-36 rounded mx-auto" />
            <Skeleton className="h-4 w-48 rounded mx-auto" />
          </div>

          <div className="border-t border-white/5 pt-4 space-y-3">
            <div>
              <Skeleton className="h-3 w-16 rounded mb-1" />
              <Skeleton className="h-4 w-44 rounded" />
            </div>
            <div>
              <Skeleton className="h-3 w-16 rounded mb-1" />
              <Skeleton className="h-4 w-32 rounded" />
            </div>
          </div>
        </div>

        {/* Right Tabbed History */}
        <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 space-y-6">
          <div className="flex gap-2 border-b border-white/5 pb-4">
            {["Activity", "Conversations", "Tickets", "Memory"].map((tab) => (
              <Skeleton key={tab} className="h-9 w-24 rounded-lg" />
            ))}
          </div>

          <div className="space-y-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <Skeleton className="h-4 w-40 rounded" />
                  <Skeleton className="h-3 w-20 rounded" />
                </div>
                <Skeleton className="h-3.5 w-full rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
