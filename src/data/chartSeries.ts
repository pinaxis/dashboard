import type { GraphDocument, GraphNode, SecretNode, FileNode } from "./graph.ts";
import type { Bar } from "./analytics.ts";
import { CATEGORY_COLOR, SERIES } from "../lib/palette.ts";

export interface TimePoint {
  at: string;
  found: number;
  critical: number;
  cumulative: number;
}

export interface ChartFilter {
  bands: Set<string>;
  types: Set<string>;
  validity: Set<"live" | "dead" | "format">;
}

export function secretValidity(node: SecretNode): "live" | "dead" | "format" {
  if (!node.validated) {
    return "format";
  }
  return node.valid ? "live" : "dead";
}

function bucketKey(iso: string, bucket: "day" | "week"): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) {
    return null;
  }
  const date = new Date(time);
  if (bucket === "week") {
    const day = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - day);
  }
  return date.toISOString().slice(0, 10);
}

export function exposuresOverTime(document: GraphDocument, bucket: "day" | "week"): TimePoint[] {
  const found = new Map<string, number>();
  const critical = new Map<string, number>();
  for (const node of document.nodes) {
    const key = bucketKey(node.firstSeen, bucket);
    if (key === null) {
      continue;
    }
    found.set(key, (found.get(key) ?? 0) + 1);
    if (node.band === "CRITICAL") {
      critical.set(key, (critical.get(key) ?? 0) + 1);
    }
  }
  let running = 0;
  return [...found.keys()].sort().map((at) => {
    running += found.get(at) ?? 0;
    return { at, found: found.get(at) ?? 0, critical: critical.get(at) ?? 0, cumulative: running };
  });
}

function tally(entries: string[], color: (label: string) => string, limit?: number): Bar[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry, (totals.get(entry) ?? 0) + 1);
  }
  const bars = [...totals.entries()]
    .map(([label, value]) => ({ label, value, color: color(label) }))
    .sort((a, b) => b.value - a.value);
  return limit == null ? bars : bars.slice(0, limit);
}

export function byCategory(document: GraphDocument): Bar[] {
  const labels = document.nodes
    .filter((node): node is SecretNode => node.type === "SECRET")
    .map((node) => node.category ?? "uncategorized");
  return tally(labels, () => CATEGORY_COLOR.credential);
}

function extensionOf(path: string | undefined): string {
  if (!path) {
    return "other";
  }
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "other";
}

export function byFileType(document: GraphDocument): Bar[] {
  const labels = document.nodes
    .filter((node): node is FileNode => node.type === "FILE")
    .map((node) => extensionOf(node.path));
  return tally(labels, () => SERIES[1], 12);
}

export function validityTotals(document: GraphDocument): { live: number; dead: number; formatOnly: number } {
  return document.stats.credentials.reduce(
    (sum, row) => ({
      live: sum.live + row.validatedLive,
      dead: sum.dead + row.validatedDead,
      formatOnly: sum.formatOnly + row.formatOnly,
    }),
    { live: 0, dead: 0, formatOnly: 0 },
  );
}

function passesValidity(node: GraphNode, validity: Set<"live" | "dead" | "format">): boolean {
  if (validity.size === 0 || node.type !== "SECRET") {
    return true;
  }
  return validity.has(secretValidity(node));
}

export function applyFilter(document: GraphDocument, filter: ChartFilter): GraphDocument {
  const keep = (node: GraphNode): boolean =>
    (filter.bands.size === 0 || filter.bands.has(node.band)) &&
    (filter.types.size === 0 || filter.types.has(node.type)) &&
    passesValidity(node, filter.validity);
  if (filter.bands.size === 0 && filter.types.size === 0 && filter.validity.size === 0) {
    return document;
  }
  // Edges address nodes by index, so narrowing nodes alone leaves every index misaligned. Remap the
  // survivors and drop any edge whose endpoints did not both survive.
  const remap = new Map<number, number>();
  const nodes: GraphNode[] = [];
  document.nodes.forEach((node, index) => {
    if (keep(node)) {
      remap.set(index, nodes.length);
      nodes.push(node);
    }
  });
  const edges = document.edges.flatMap((edge) => {
    const source = remap.get(edge.s);
    const target = remap.get(edge.t);
    return source === undefined || target === undefined ? [] : [{ ...edge, s: source, t: target }];
  });
  return { ...document, nodes, edges };
}
