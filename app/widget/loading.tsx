import { Skeleton } from "@/src/components/ui/skeleton";

export default function WidgetLoading() {
  return (
    <div className="flex h-screen w-full flex-col bg-white" role="status" aria-live="polite">
      <span className="sr-only">Loading chat widget...</span>
      {/* Header skeleton */}
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <Skeleton className="h-10 w-10 rounded-full bg-slate-200" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-32 rounded bg-slate-200" />
          <Skeleton className="h-3 w-20 rounded bg-slate-100" />
        </div>
      </div>
      {/* Chat message bubbles skeleton */}
      <div className="flex-1 space-y-4 p-4">
        <div className="flex items-start gap-2.5">
          <Skeleton className="h-7 w-7 rounded-full bg-slate-200" />
          <div className="space-y-1.5 max-w-[75%]">
            <Skeleton className="h-14 w-52 rounded-2xl rounded-tl-sm bg-slate-100 p-3" />
          </div>
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-9 w-36 rounded-2xl rounded-tr-sm bg-slate-200/80" />
        </div>
      </div>
      {/* Footer input skeleton */}
      <div className="border-t border-slate-100 p-3">
        <Skeleton className="h-10 w-full rounded-xl bg-slate-100" />
      </div>
    </div>
  );
}
