import { Skeleton } from "@/src/components/ui/skeleton";

export default function ChatsLoading() {
  return (
    <div className="flex h-[calc(100vh-64px)] w-full overflow-hidden" role="status" aria-live="polite">
      <span className="sr-only">Loading live chats...</span>

      {/* Left conversation sessions list */}
      <div className="w-80 sm:w-96 border-r border-white/10 bg-[#070707] flex flex-col">
        <div className="p-4 border-b border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-24 rounded" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>

        <div className="flex-1 divide-y divide-white/5 overflow-y-auto">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="p-4 flex items-start gap-3">
              <Skeleton className="h-10 w-10 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5 min-w-0">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-28 rounded" />
                  <Skeleton className="h-3 w-12 rounded" />
                </div>
                <Skeleton className="h-3.5 w-full rounded" />
                <Skeleton className="h-3 w-20 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right chat message area */}
      <div className="flex-1 flex flex-col bg-[#0a0a0a]">
        <div className="h-16 border-b border-white/10 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="h-3 w-24 rounded" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
        </div>

        <div className="flex-1 p-6 space-y-6">
          <div className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="space-y-1">
              <Skeleton className="h-3.5 w-24 rounded" />
              <Skeleton className="h-16 w-80 rounded-2xl" />
            </div>
          </div>
          <div className="flex flex-row-reverse gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="space-y-1 items-end">
              <Skeleton className="h-3.5 w-24 rounded ml-auto" />
              <Skeleton className="h-24 w-96 rounded-2xl" />
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/10">
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
