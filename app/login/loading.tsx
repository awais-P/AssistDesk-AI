import { Skeleton } from "@/src/components/ui/skeleton";

export default function LoginLoading() {
  return (
    <div className="min-h-screen bg-[#020202] text-white" role="status" aria-live="polite">
      <span className="sr-only">Loading login...</span>

      {/* Navbar skeleton */}
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Skeleton className="h-8 w-36 rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-xl" />
      </nav>

      <main className="mx-auto max-w-5xl px-6 pt-10 pb-16">
        <div className="grid gap-8 md:grid-cols-2 items-center">
          {/* Left branding card */}
          <div className="space-y-4">
            <Skeleton className="h-4 w-28 rounded" />
            <Skeleton className="h-10 w-4/5 rounded-xl" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-3/4 rounded" />
            <div className="pt-6 space-y-3">
              <Skeleton className="h-16 w-full rounded-2xl" />
            </div>
          </div>

          {/* Right form card */}
          <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-8 space-y-5">
            <div>
              <Skeleton className="h-4 w-24 rounded" />
              <Skeleton className="mt-2 h-7 w-48 rounded-lg" />
            </div>
            <div className="space-y-4 pt-2">
              <div>
                <Skeleton className="h-3.5 w-24 rounded mb-2" />
                <Skeleton className="h-11 w-full rounded-2xl" />
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <Skeleton className="h-3.5 w-20 rounded" />
                  <Skeleton className="h-3.5 w-24 rounded" />
                </div>
                <Skeleton className="h-11 w-full rounded-2xl" />
              </div>
              <Skeleton className="h-12 w-full rounded-2xl bg-white/15" />
            </div>
            <div className="pt-4 text-center">
              <Skeleton className="h-4 w-48 rounded mx-auto" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
