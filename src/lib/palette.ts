// Pre-validated dark-surface steps from the dataviz reference palette (worst adjacent CVD deltaE clears
// the pairlist floor). Categorical hues are assigned in this fixed order and never cycled.
export const SERIES = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
];

// Reserved status roles - never reused as a categorical slot. A live leaked key is critical.
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
};

export const SURFACE = "#1a1a19";
export const GRID = "#33322f";
export const INK = {
  primary: "#ffffff",
  secondary: "#c3c2b7",
  muted: "#8a897f",
};

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

// Severity is an ordered state, so it wears the reserved status ramp (worst to least): a node's fill
// says how bad, never which kind. Type identity is carried separately by the ring colour below.
export const BAND_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type Band = (typeof BAND_ORDER)[number];
export const BAND_COLOR: Record<string, string> = {
  CRITICAL: STATUS.critical,
  HIGH: STATUS.serious,
  MEDIUM: STATUS.warning,
  LOW: STATUS.good,
};

// Node type is an identity, so it wears a fixed categorical slot, assigned once and never cycled.
export const CATEGORY_COLOR: Record<string, string> = {
  credential: SERIES[0],
  extension: SERIES[1],
  band: SERIES[2],
  repositories: SERIES[3],
};

export const TYPE_ORDER = ["SECRET", "REPOSITORY", "OWNER", "PACKAGE", "MAINTAINER", "PLATFORM", "FILE"] as const;
export type NodeTypeName = (typeof TYPE_ORDER)[number];
export const TYPE_COLOR: Record<string, string> = {
  SECRET: SERIES[0],
  REPOSITORY: SERIES[1],
  OWNER: SERIES[2],
  PACKAGE: SERIES[3],
  MAINTAINER: SERIES[4],
  PLATFORM: SERIES[5],
  FILE: SERIES[6],
};

export const DIM = "#3a3a37";
