import type { GraphDocument, PackageNode } from "./graph.ts";
import { TYPE_COLOR, SERIES } from "../lib/palette.ts";

export interface Bar {
  label: string;
  value: number;
  color: string;
}

export function topPackages(document: GraphDocument): Bar[] {
  return document.nodes
    .filter((node): node is PackageNode => node.type === "PACKAGE" && node.popularity != null)
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, 10)
    .map((node) => ({
      label: node.label && node.label.trim() ? node.label : node.target,
      value: node.popularity ?? 0,
      color: TYPE_COLOR.PACKAGE,
    }));
}

export function coOccurrenceBars(document: GraphDocument): Bar[] {
  return document.stats.coOccurrence
    .slice(0, 8)
    .map((pair) => ({ label: `${pair.a} + ${pair.b}`, value: pair.repositories, color: SERIES[6] }));
}

// True once a build carries real package names; older exports left them null, so the chart falls back
// to summing popularity per ecosystem instead of repeating the target name.
export function hasNamedPackages(document: GraphDocument): boolean {
  return document.nodes.some((node) =>
    node.type === "PACKAGE" && typeof node.label === "string" && node.label.trim() !== "" && node.label !== node.target);
}

export function packagesByEcosystem(document: GraphDocument): Bar[] {
  const totals = new Map<string, number>();
  for (const node of document.nodes) {
    if (node.type === "PACKAGE" && node.popularity != null) {
      totals.set(node.target, (totals.get(node.target) ?? 0) + node.popularity);
    }
  }
  return [...totals.entries()]
    .map(([target, value]) => ({ label: target, value, color: TYPE_COLOR.PACKAGE }))
    .sort((a, b) => b.value - a.value);
}
