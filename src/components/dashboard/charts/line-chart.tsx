"use client";

import type { PointerEvent, ReactNode } from "react";
import { ChartTooltip, useActiveIndex, useChartWidth } from "./chart-primitives";
import { niceTicks } from "./format";
import { CHART_INK } from "./palette";

export type LineSeries = {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  /** null = no data at that point: the line breaks instead of dropping to zero. */
  values: Array<number | null>;
};

type LineChartProps = {
  labels: string[];
  series: LineSeries[];
  ariaLabel: string;
  height?: number;
  /** Show every n-th x label. */
  xLabelEvery?: number;
  yTickFormat: (value: number, maxTick: number) => string;
  renderTooltip: (index: number) => ReactNode;
};

const MARGIN = { top: 12, right: 16, bottom: 28, left: 60 };

/**
 * Multi-series line chart (inline SVG): 2px lines, hairline grid, gaps for missing
 * points, crosshair that snaps to the nearest X on hover or arrow keys.
 */
export function LineChart({ labels, series, ariaLabel, height = 240, xLabelEvery = 3, yTickFormat, renderTooltip }: LineChartProps) {
  const { ref, width } = useChartWidth();
  const count = labels.length;
  const lastWithData = () => {
    for (let index = count - 1; index >= 0; index -= 1) {
      if (series.some((item) => item.values[index] !== null && item.values[index] !== undefined)) return index;
    }
    return Math.max(0, count - 1);
  };
  const { active, setActive, focusProps } = useActiveIndex(count, lastWithData);

  const plotWidth = Math.max(40, width - MARGIN.left - MARGIN.right);
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const max = Math.max(0, ...series.flatMap((item) => item.values.filter((value): value is number => value !== null)));
  const ticks = niceTicks(max, 4);
  const yMax = ticks[ticks.length - 1];
  const step = count > 1 ? plotWidth / (count - 1) : 0;
  const xAt = (index: number) => MARGIN.left + (count > 1 ? index * step : plotWidth / 2);
  const yAt = (value: number) => MARGIN.top + plotHeight - (value / yMax) * plotHeight;
  // Thin the x labels on narrow charts (~56px per label) so they never collide.
  const labelEvery = Math.max(xLabelEvery, Math.ceil(count / Math.max(1, Math.floor(plotWidth / 56))));
  const showLabel = (index: number) =>
    index % labelEvery === 0 || (index === count - 1 && (count - 1) % labelEvery >= labelEvery * 0.75);

  function segments(values: Array<number | null>) {
    const runs: Array<Array<[number, number]>> = [];
    let current: Array<[number, number]> = [];

    values.forEach((value, index) => {
      if (value === null || value === undefined) {
        if (current.length) runs.push(current);
        current = [];
      } else {
        current.push([xAt(index), yAt(value)]);
      }
    });

    if (current.length) runs.push(current);
    return runs;
  }

  function handlePointer(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    // The hit area starts half a step left of the first point.
    const x = event.clientX - box.left - step / 2;
    const index = count > 1 ? Math.round(x / step) : 0;
    setActive(Math.max(0, Math.min(count - 1, index)));
  }

  return (
    <div ref={ref} className="relative w-full select-none">
      <div
        {...focusProps}
        role="img"
        aria-label={ariaLabel}
        aria-roledescription="line chart"
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
                {yTickFormat(tick, yMax)}
              </text>
            </g>
          ))}

          {labels.map((label, index) =>
            showLabel(index) ? (
              <text
                key={`${label}-${index}`}
                x={xAt(index)}
                y={height - 8}
                textAnchor={index === 0 ? "start" : index === count - 1 ? "end" : "middle"}
                fontSize="11"
                fill={CHART_INK.muted}
                className="tabular-nums"
              >
                {label}
              </text>
            ) : null,
          )}

          {active !== null ? (
            <line
              x1={xAt(active)}
              x2={xAt(active)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
              stroke={CHART_INK.secondary}
              strokeOpacity="0.5"
              strokeWidth="1"
              shapeRendering="crispEdges"
            />
          ) : null}

          {series.map((item) =>
            segments(item.values).map((run, runIndex) =>
              run.length === 1 ? (
                <circle key={`${item.key}-${runIndex}`} cx={run[0][0]} cy={run[0][1]} r="3" fill={item.color} />
              ) : (
                <polyline
                  key={`${item.key}-${runIndex}`}
                  points={run.map(([x, y]) => `${x},${y}`).join(" ")}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap={item.dashed ? "butt" : "round"}
                  strokeDasharray={item.dashed ? "5 4" : undefined}
                />
              ),
            ),
          )}

          {active !== null
            ? series.map((item) => {
                const value = item.values[active];
                return value === null || value === undefined ? null : (
                  <circle
                    key={item.key}
                    cx={xAt(active)}
                    cy={yAt(value)}
                    r="4.5"
                    fill={item.color}
                    stroke={CHART_INK.surface}
                    strokeWidth="2"
                  />
                );
              })
            : null}

          <rect
            x={MARGIN.left - (count > 1 ? step / 2 : plotWidth / 2)}
            y={MARGIN.top}
            width={plotWidth + (count > 1 ? step : plotWidth)}
            height={plotHeight}
            fill="transparent"
            onPointerMove={handlePointer}
            onPointerDown={handlePointer}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      </div>

      {active !== null ? (
        <ChartTooltip x={xAt(active)} width={width}>
          {renderTooltip(active)}
        </ChartTooltip>
      ) : null}
    </div>
  );
}
