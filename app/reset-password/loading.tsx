import { Skeleton } from "@/src/components/ui/skeleton";

export default function ResetPasswordLoading() {
  return (
    <div className="min-h-screen bg-[#020202] text-white" role="status" aria-live="polite">
      <span className="sr-only">Loading password reset...</span>

      {/* Navbar skeleton */}
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Skeleton className="h-8 w-36 rounded-lg" />
        <Skeleton className="h-9 w-20 rounded-xl" />
      </nav>

      <main className="mx-auto max-w-md px-6 pt-16 pb-16">
        <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-8 space-y-6">
          <div className="text-center space-y-2">
            <Skeleton className="h-12 w-12 rounded-2xl mx-auto mb-4" />
            <Skeleton className="h-7 w-48 rounded-lg mx-auto" />
            <Skeleton className="h-4 w-64 rounded mx-auto" />
          </div>

          <div className="space-y-4 pt-2">
            <div>
              <Skeleton className="h-3.5 w-28 rounded mb-2" />
              <Skeleton className="h-11 w-full rounded-2xl" />
            </div>
            <div>
              <Skeleton className="h-3.5 w-32 rounded mb-2" />
              <Skeleton className="h-11 w-full rounded-2xl" />
            </div>
            <Skeleton className="h-12 w-full rounded-2xl bg-white/15" />
          </div>
        </div>
      </main>
    </div>
  );
}
