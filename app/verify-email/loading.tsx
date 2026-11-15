import { Skeleton } from "@/src/components/ui/skeleton";

export default function VerifyEmailLoading() {
  return (
    <div className="min-h-screen bg-[#020202] text-white" role="status" aria-live="polite">
      <span className="sr-only">Verifying email...</span>

      {/* Navbar skeleton */}
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Skeleton className="h-8 w-36 rounded-lg" />
        <Skeleton className="h-9 w-20 rounded-xl" />
      </nav>

      <main className="mx-auto max-w-lg px-6 pt-16 pb-16">
        <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-8 space-y-6 text-center">
          <Skeleton className="h-14 w-14 rounded-2xl mx-auto" />
          <Skeleton className="h-7 w-60 rounded-lg mx-auto" />
          <Skeleton className="h-4 w-80 max-w-full rounded mx-auto" />
          <Skeleton className="h-4 w-64 max-w-full rounded mx-auto" />
          <div className="pt-4 flex justify-center gap-3">
            <Skeleton className="h-10 w-32 rounded-xl" />
            <Skeleton className="h-10 w-28 rounded-xl bg-white/15" />
          </div>
        </div>
      </main>
    </div>
  );
}
