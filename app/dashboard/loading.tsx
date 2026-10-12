export default function DashboardLoading() {
  return (
    <div className="px-5 py-4 md:px-6" role="status" aria-live="polite">
      <span className="sr-only">Loading page...</span>
      <div className="animate-pulse" aria-hidden="true">
        <div className="h-8 w-48 rounded-lg bg-white/[0.06]" />
        <div className="mt-3 h-4 w-80 max-w-full rounded bg-white/[0.04]" />

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="h-28 rounded-xl border border-white/10 bg-[#0a0a0a]"
            />
          ))}
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <div className="h-72 rounded-xl border border-white/10 bg-[#0a0a0a]" />
          <div className="h-72 rounded-xl border border-white/10 bg-[#0a0a0a]" />
        </div>
      </div>
    </div>
  );
}
