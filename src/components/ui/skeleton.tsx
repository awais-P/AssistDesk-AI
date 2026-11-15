import type { HTMLAttributes } from "react";

export function Skeleton({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`animate-pulse rounded-md bg-white/[0.07] ${className}`}
      aria-hidden="true"
      {...props}
    />
  );
}

export function SkeletonHeader({
  titleWidth = "w-48",
  subtitleWidth = "w-72",
  hasAction = false,
}: {
  titleWidth?: string;
  subtitleWidth?: string;
  hasAction?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <Skeleton className={`h-8 ${titleWidth} rounded-lg`} />
        <Skeleton className={`mt-2 h-4 ${subtitleWidth} rounded`} />
      </div>
      {hasAction ? (
        <Skeleton className="h-10 w-32 rounded-xl bg-white/10" />
      ) : null}
    </div>
  );
}

export function SkeletonStatGrid({
  count = 4,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-${Math.min(count, 4)} ${className}`}
    >
      {Array.from({ length: count }, (_, idx) => (
        <div
          key={idx}
          className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-24 rounded" />
            <Skeleton className="h-5 w-5 rounded-full" />
          </div>
          <Skeleton className="mt-4 h-7 w-20 rounded-lg" />
          <Skeleton className="mt-2 h-3 w-32 rounded" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({
  className = "",
  children,
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-[#0a0a0a] p-5 md:p-6 ${className}`}
    >
      {children || (
        <>
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-36 rounded-md" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-4 w-full rounded" />
          <Skeleton className="mt-2 h-4 w-4/5 rounded" />
          <div className="mt-6 flex items-center justify-between pt-4 border-t border-white/5">
            <Skeleton className="h-3.5 w-24 rounded" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </>
      )}
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  cols = 4,
  className = "",
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] ${className}`}
    >
      {/* Table header skeleton */}
      <div className="flex items-center gap-4 border-b border-white/10 bg-white/[0.02] px-6 py-4">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton
            key={i}
            className={`h-4 rounded ${i === 0 ? "w-40" : "flex-1"}`}
          />
        ))}
      </div>
      {/* Table rows skeleton */}
      <div className="divide-y divide-white/5">
        {Array.from({ length: rows }, (_, rowIdx) => (
          <div
            key={rowIdx}
            className="flex items-center gap-4 px-6 py-4"
          >
            {Array.from({ length: cols }, (_, colIdx) => (
              <Skeleton
                key={colIdx}
                className={`h-4 rounded ${
                  colIdx === 0
                    ? "w-44"
                    : colIdx === cols - 1
                      ? "w-20"
                      : "flex-1"
                }`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
