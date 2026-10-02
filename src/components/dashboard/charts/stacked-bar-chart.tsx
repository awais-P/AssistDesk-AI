"use client";

import type { ReactNode } from "react";
import { ChartTooltip, useActiveIndex, useChartWidth } from "./chart-primitives";
import { formatCompact, niceTicks } from "./format";
import { CHART_INK } from "./palette";

export type StackSeries = { key: string; label: string; color: string };

export type StackCategory = {
  key: string;
  /** Axis label (shown selectively when there are many categories). */
  label: string;
  values: Record<string, number>;
};

type StackedBarChartProps = {
  categories: StackCategory[];
  series: StackSeries[];
  ariaLabel: string;
  height?: number;
  renderTooltip: (index: number) => ReactNode;
};

const MARGIN = { top: 12, right: 12, bottom: 28, left: 44 };
const GAP = 2;
const MAX_BAR = 24;
const RADIUS = 4;

/** Rect with only the top corners rounded (data end), square at the baseline. */
function topRoundedPath(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

/**
 * Stacked columns (inline SVG): <= 24px bars, 2px surface gap between segments,
 * 4px rounded top. Each column (its whole band) is the hover target; arrow keys move
 * between columns.
 */
export function StackedBarChart({ categories, series, ariaLabel, height = 240, renderTooltip }: StackedBarChartProps) {
  const { ref, width } = useChartWidth();
  const count = categories.length;
  const { active, setActive, focusProps } = useActiveIndex(count, () => Math.max(0, count - 1));

  const plotWidth = Math.max(40, width - MARGIN.left - MARGIN.right);
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const totals = categories.map((category) => series.reduce((sum, item) => sum + (category.values[item.key] ?? 0), 0));
  const ticks = niceTicks(Math.max(0, ...totals), 4, true);
  const yMax = ticks[ticks.length - 1];
  const band = count ? plotWidth / count : plotWidth;
  const barWidth = Math.max(1, Math.min(MAX_BAR, band > 6 ? band * 0.72 : band - 1));
  const yAt = (value: number) => MARGIN.top + plotHeight - (value / yMax) * plotHeight;
  const labelEvery = Math.max(1, Math.ceil(count / Math.max(1, Math.floor(plotWidth / 64))));

  return (
    <div ref={ref} className="relative w-full select-none">
      <div
        {...focusProps}
        role="img"
        aria-label={ariaLabel}
        aria-roledescription="stacked bar chart"
        className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <svg width={width} height={height} className="block" aria-hidden="true">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={yAt(tick)}
                y2={yAt(tick)}
                stroke={tick === 0 ? CHART_INK.axis : CHART_INK.grid}
                strokeWidth="1"
                shapeRendering="crispEdges"
              />
              <text x={MARGIN.left - 8} y={yAt(tick)} dy="0.32em" textAnchor="end" fontSize="11" fill={CHART_INK.muted} className="tabular-nums">
                {formatCompact(tick)}
              </text>
            </g>
          ))}

          {categories.map((category, index) => {
            const center = MARGIN.left + band * index + band / 2;
            const x = center - barWidth / 2;
            const nonZero = series.filter((item) => (category.values[item.key] ?? 0) > 0);
            let running = 0;

            return (
              <g key={category.key} opacity={active !== null && active !== index ? 0.55 : 1}>
                {nonZero.map((item, position) => {
                  const value = category.values[item.key] ?? 0;
                  const bottom = yAt(running);
                  running += value;
                  const top = yAt(running);
                  // Every segment above the first leaves a 2px surface gap below it.
                  const gap = position > 0 && bottom - top > GAP + 1 ? GAP : 0;
                  const segmentHeight = Math.max(0.5, bottom - top - gap);

                  return position === nonZero.length - 1 ? (
                    <path key={item.key} d={topRoundedPath(x, top, barWidth, segmentHeight, RADIUS)} fill={item.color} />
                  ) : (
                    <rect key={item.key} x={x} y={top} width={barWidth} height={segmentHeight} fill={item.color} />
                  );
                })}
                {index % labelEvery === 0 ? (
                  <text x={center} y={height - 8} textAnchor="middle" fontSize="11" fill={CHART_INK.muted} className="tabular-nums">
                    {category.label}
                  </text>
                ) : null}
                <rect
                  x={MARGIN.left + band * index}
                  y={MARGIN.top}
                  width={band}
                  height={plotHeight}
                  fill="transparent"
                  onPointerEnter={() => setActive(index)}
                  onPointerDown={() => setActive(index)}
                  onPointerLeave={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {active !== null ? (
        <ChartTooltip x={MARGIN.left + band * active + band / 2} width={width}>
          {renderTooltip(active)}
        </ChartTooltip>
      ) : null}
    </div>
  );
}
