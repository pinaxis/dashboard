import type { GraphDocument } from "../data/graph";
import { nodeName } from "../data/graph";
import { BAND_COLOR, TYPE_COLOR, INK } from "../lib/palette";
import { nodeSize, importance, severityFill } from "./scene";
import { seedPosition, hasStoredLayout } from "./settle";

export interface NodeStyle {
  label: string;
  nodeType: string;
  band: string;
  verify: string | null;
  severity: number;
  size: number;
  sevColor: string;
  sevBorder: string;
  typeColor: string;
  typeBorder: string;
  forceLabel: boolean;
  zIndex: number;
}

export interface Edge {
  j: number;
  edgeType: string;
}

export interface GraphModel {
  count: number;
  x: number[];
  y: number[];
  importance: number[];
  style: NodeStyle[];
  neighbors: Edge[][];
}

const BAND_TIER: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

// Turns a graph document into flat, renderer-free arrays: positions, importance, per-node display
// style, and an adjacency list. The GraphView holds this whole model but only ever loads a window of
// it into the renderer.
export function buildModel(document: GraphDocument): GraphModel {
  const count = document.nodes.length;
  const degree = new Array<number>(count).fill(0);
  const neighbors: Edge[][] = Array.from({ length: count }, () => []);
  const drawn = new Set<string>();
  for (const edge of document.edges) {
    if (edge.s === edge.t) {
      continue;
    }
    const from = Math.min(edge.s, edge.t);
    const to = Math.max(edge.s, edge.t);
    const key = `${from}-${to}`;
    if (drawn.has(key) || from < 0 || to >= count) {
      continue;
    }
    drawn.add(key);
    degree[edge.s] += 1;
    degree[edge.t] += 1;
    neighbors[edge.s].push({ j: edge.t, edgeType: edge.type });
    neighbors[edge.t].push({ j: edge.s, edgeType: edge.type });
  }
  const widestReach = Math.max(1, ...degree);

  const stored = hasStoredLayout(document);
  const x = new Array<number>(count);
  const y = new Array<number>(count);
  const importanceOf = new Array<number>(count);
  const style = new Array<NodeStyle>(count);

  document.nodes.forEach((node, index) => {
    const reach = Math.sqrt(degree[index] / widestReach);
    const position = stored ? { x: node.x as number, y: node.y as number } : seedPosition(index);
    x[index] = position.x;
    y[index] = position.y;
    importanceOf[index] = importance(node.band, reach);
    const bandColor = BAND_COLOR[node.band] ?? INK.muted;
    const typeColor = TYPE_COLOR[node.type] ?? INK.muted;
    style[index] = {
      label: nodeName(node),
      nodeType: node.type,
      band: node.band,
      verify: node.type === "SECRET" ? (node.validated ? (node.valid ? "live" : "dead") : "format") : null,
      severity: node.severity,
      size: nodeSize(node.band, reach),
      sevColor: severityFill(node.band, bandColor),
      sevBorder: bandColor,
      typeColor: severityFill(node.band, typeColor),
      typeBorder: typeColor,
      forceLabel: node.band === "HIGH" || node.band === "CRITICAL",
      zIndex: (BAND_TIER[node.band] ?? 1) * 1000 + Math.round(reach * 100),
    };
  });

  return { count, x, y, importance: importanceOf, style, neighbors };
}
