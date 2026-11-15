import { Skeleton } from "@/src/components/ui/skeleton";

export default function RootLoading() {
  return (
    <div className="min-h-screen bg-[#020202] text-white" role="status" aria-live="polite">
      <span className="sr-only">Loading AssistDesk...</span>

      {/* Navbar skeleton */}
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Skeleton className="h-8 w-36 rounded-lg" />
        <div className="hidden md:flex items-center gap-6">
          <Skeleton className="h-4 w-16 rounded" />
          <Skeleton className="h-4 w-16 rounded" />
          <Skeleton className="h-4 w-16 rounded" />
          <Skeleton className="h-4 w-16 rounded" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-20 rounded-xl" />
          <Skeleton className="h-9 w-28 rounded-xl bg-white/15" />
        </div>
      </nav>

      {/* Hero section skeleton */}
      <main className="mx-auto max-w-5xl px-6 pt-16 pb-24 text-center">
        <div className="flex justify-center mb-6">
          <Skeleton className="h-7 w-52 rounded-full" />
        </div>
        <div className="space-y-4 max-w-3xl mx-auto flex flex-col items-center">
          <Skeleton className="h-12 w-4/5 rounded-2xl" />
          <Skeleton className="h-12 w-3/5 rounded-2xl" />
          <Skeleton className="h-5 w-2/3 rounded-lg mt-4" />
        </div>
        <div className="mt-8 flex justify-center gap-4">
          <Skeleton className="h-12 w-36 rounded-2xl bg-white/15" />
          <Skeleton className="h-12 w-36 rounded-2xl" />
        </div>

        {/* Hero preview card */}
        <div className="mt-16 mx-auto max-w-4xl rounded-3xl border border-white/10 bg-[#0a0a0a] p-6 shadow-2xl">
          <Skeleton className="h-[420px] w-full rounded-2xl" />
        </div>
      </main>
    </div>
  );
}
