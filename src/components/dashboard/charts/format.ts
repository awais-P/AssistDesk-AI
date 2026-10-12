/**
 * Formatting helpers shared by the Analytics pages and their charts. Client-safe (no
 * server imports). Every helper returns "—" for null so a missing value is never
 * shown as a fake zero.
 */

const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const EMPTY_VALUE = "—";

export function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined ? EMPTY_VALUE : numberFormatter.format(value);
}

/** 1,284 / 12.9K / 4.2M: for tight spaces such as axis ticks. */
export function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined) return EMPTY_VALUE;
  return Math.abs(value) < 10_000 ? numberFormatter.format(value) : compactFormatter.format(value);
}

/** "420 ms" below one second, "1.8 s" below a minute, then "2m 05s". */
export function formatMs(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return EMPTY_VALUE;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return formatDuration(ms / 1000);
}

/** Axis ticks for a millisecond scale: all in ms below 2 s ("250"), else all in seconds ("1.5 s"). */
export function msTickFormatter(maxTick: number) {
  if (maxTick < 2000) return (ms: number) => `${Math.round(ms)} ms`;
  return (ms: number) => `${Number.isInteger(ms / 1000) ? ms / 1000 : (ms / 1000).toFixed(1)} s`;
}

/** A 0..1 fraction as a percentage: 0.724 → "72%". */
export function formatPercent(rate: number | null | undefined, digits = 0) {
  if (rate === null || rate === undefined) return EMPTY_VALUE;
  return `${(rate * 100).toFixed(digits)}%`;
}

/** Duration in seconds: "45s", "4m 12s", "2h 05m", "3d 4h". */
export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return EMPTY_VALUE;
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Relative change (0.12 → "+12%"). */
export function formatChange(change: number) {
  const percent = Math.round(change * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

/** Difference between two rates in percentage points (0.04 → "+4 pts"). */
export function formatPoints(difference: number) {
  const points = Math.round(difference * 1000) / 10;
  const text = Number.isInteger(points) ? `${points}` : points.toFixed(1);
  return `${points > 0 ? "+" : ""}${text} pts`;
}

/** Share of a total as a percentage, "—" when the total is zero. */
export function formatShare(part: number, total: number) {
  return total > 0 ? formatPercent(part / total) : EMPTY_VALUE;
}

/**
 * Clean axis ticks (0, 250, 500 …) covering 0..max, about `count` steps. `integer`
 * keeps the step at 1 or more (for counts).
 */
export function niceTicks(max: number, count = 4, integer = false) {
  if (!Number.isFinite(max) || max <= 0) {
    return [0, 1];
  }

  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const niceStep = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
  const step = integer ? Math.max(1, Math.round(niceStep)) : niceStep;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];

  for (let value = 0; value <= top + step / 2; value += step) {
    ticks.push(Math.round(value * 1e6) / 1e6);
  }

  return ticks;
}
