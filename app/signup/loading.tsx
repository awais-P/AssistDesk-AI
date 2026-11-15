import { Skeleton } from "@/src/components/ui/skeleton";

export default function SignupLoading() {
  return (
    <div className="min-h-screen bg-[#020202] text-white" role="status" aria-live="polite">
      <span className="sr-only">Loading sign up...</span>

      {/* Navbar skeleton */}
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Skeleton className="h-8 w-36 rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-xl" />
      </nav>

      <main className="mx-auto max-w-5xl px-6 pt-8 pb-16">
        <div className="grid gap-8 md:grid-cols-[1.05fr_0.95fr] items-start">
          {/* Left info card */}
          <div className="space-y-4">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-10 w-4/5 rounded-xl" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-3/4 rounded" />

            <div className="mt-8 grid gap-4 sm:grid-cols-2 pt-4">
              <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 space-y-2">
                <Skeleton className="h-6 w-16 rounded" />
                <Skeleton className="h-3.5 w-full rounded" />
                <Skeleton className="h-3.5 w-3/4 rounded" />
              </div>
              <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 space-y-2">
                <Skeleton className="h-6 w-16 rounded" />
                <Skeleton className="h-3.5 w-full rounded" />
                <Skeleton className="h-3.5 w-3/4 rounded" />
              </div>
            </div>
          </div>

          {/* Right form card */}
          <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-8 space-y-5">
            <div>
              <Skeleton className="h-4 w-20 rounded" />
              <Skeleton className="mt-2 h-7 w-60 rounded-lg" />
            </div>
            <div className="space-y-4 pt-2">
              <div>
                <Skeleton className="h-3.5 w-24 rounded mb-2" />
                <Skeleton className="h-11 w-full rounded-2xl" />
              </div>
              <div>
                <Skeleton className="h-3.5 w-24 rounded mb-2" />
                <Skeleton className="h-11 w-full rounded-2xl" />
              </div>
              <div>
                <Skeleton className="h-3.5 w-20 rounded mb-2" />
                <Skeleton className="h-11 w-full rounded-2xl" />
              </div>
              <div>
                <Skeleton className="h-3.5 w-32 rounded mb-2" />
                <Skeleton className="h-11 w-full rounded-2xl" />
              </div>
              <Skeleton className="h-12 w-full rounded-2xl bg-white/15" />
            </div>
            <div className="pt-2 text-center">
              <Skeleton className="h-4 w-52 rounded mx-auto" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
