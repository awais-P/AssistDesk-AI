/**
 * Chart colours for the (always dark) dashboard. Categorical slots are assigned to
 * channels in a fixed order so a channel keeps its colour whatever the filter.
 * Validated against the #0a0a0a card surface (dark mode): lightness band, chroma,
 * adjacent CVD separation (worst ΔE 8.4) and >= 3:1 contrast all pass.
 * Status colours are reserved for resolution state and always ship with a label.
 */

export const CHANNEL_ORDER = ["WEB_WIDGET", "WHATSAPP", "SLACK", "EMAIL"] as const;

export const CHANNEL_COLORS: Record<string, string> = {
  WEB_WIDGET: "#3987e5", // slot 1 blue
  WHATSAPP: "#d95926", // slot 2 orange
  SLACK: "#199e70", // slot 3 aqua
  EMAIL: "#c98500", // slot 4 yellow
};

export const SERIES_PRIMARY = "#3987e5";
/** De-emphasised companion series (e.g. p95 next to the average). */
export const SERIES_MUTED = "#898781";

export const STATUS_COLORS = {
  good: "#0ca30c",
  warning: "#fab219",
  neutral: "#64748b",
  info: "#3987e5",
} as const;

export const CHART_INK = {
  surface: "#0a0a0a",
  grid: "#1f1f1e",
  axis: "#383835",
  muted: "#898781",
  secondary: "#c3c2b7",
} as const;
