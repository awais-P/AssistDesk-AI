"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/** Width of a chart container, tracked with ResizeObserver (charts render at real pixels). */
export function useChartWidth(initial = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const update = () => {
      const next = Math.floor(element.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/**
 * Roving "active index" for a chart: pointer hover and keyboard (arrows, Home/End)
 * drive the same crosshair and tooltip, so every readout is reachable by focus.
 */
export function useActiveIndex(count: number, preferredStart: () => number) {
  const [active, setActive] = useState<number | null>(null);

  function onKeyDown(event: KeyboardEvent) {
    if (count === 0) return;
    const current = active ?? preferredStart();
    let next: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(count - 1, current + 1);
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, current - 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = count - 1;
    if (event.key === "Escape") {
      setActive(null);
      return;
    }

    if (next !== null) {
      event.preventDefault();
      setActive(next);
    }
  }

  return {
    active,
    setActive,
    focusProps: {
      tabIndex: 0,
      onKeyDown,
      onFocus: () => setActive((value) => value ?? preferredStart()),
      onBlur: () => setActive(null),
    },
  };
}

/** Floating readout next to the crosshair / hovered mark. Flips to stay inside the chart. */
export function ChartTooltip({
  x,
  width,
  top = 8,
  children,
}: {
  x: number;
  width: number;
  top?: number;
  children: ReactNode;
}) {
  const flip = x > width * 0.6;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border border-white/10 bg-[#141414] px-3 py-2 text-xs shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
      style={{ top, left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined }}
    >
      {children}
    </div>
  );
}

export function TooltipTitle({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-medium text-slate-400">{children}</p>;
}

/** Value leads (strong), label follows; keyed by a short line of the series colour. */
export function TooltipRow({
  color,
  label,
  value,
  dashed = false,
  shape = "line",
}: {
  color?: string;
  label: string;
  value: string;
  dashed?: boolean;
  shape?: "line" | "none";
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {shape === "line" && color ? (
        <svg width="12" height="4" aria-hidden="true" className="shrink-0">
          <line x1="0" y1="2" x2="12" y2="2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? "3 3" : undefined} />
        </svg>
      ) : (
        <span className="w-3 shrink-0" aria-hidden="true" />
      )}
      <span className="font-semibold tabular-nums text-white">{value}</span>
      <span className="text-slate-400">{label}</span>
    </div>
  );
}

/** Legend entry: the swatch mirrors the mark (rect for bars, line for lines). */
export function LegendItem({
  color,
  label,
  shape = "rect",
  dashed = false,
}: {
  color: string;
  label: ReactNode;
  shape?: "rect" | "line";
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
      {shape === "rect" ? (
        <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} aria-hidden="true" />
      ) : (
        <svg width="16" height="4" aria-hidden="true" className="shrink-0">
          <line x1="1" y1="2" x2="15" y2="2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? "3 3" : undefined} />
        </svg>
      )}
      {label}
    </span>
  );
}
