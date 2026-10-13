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
