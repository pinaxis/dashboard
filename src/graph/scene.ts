import Graph from "graphology";
import type { CategoryEdge, CategoryNode, GraphDocument } from "../data/graph.ts";
import { nodeName } from "../data/graph.ts";
import { BAND_COLOR, CATEGORY_COLOR, TYPE_COLOR, INK } from "../lib/palette.ts";
import { hasStoredLayout, settle, topology } from "./settle.ts";

const MIN_SIZE = 2.5;
const MAX_SIZE = 30;
const EDGE_COLOR = "#2b2a27";
const ALWAYS_LABEL = 18;

// A node's prominence blends how bad it is with how far it reaches, so a lone critical secret stays
// visible at the overview instead of shrinking to a dot the way a pure blast-radius size would.
function rank(graph: Graph): void {
  let widestReach = 1;
  let worstSeverity = 1;
  graph.forEachNode((node, attributes) => {
    widestReach = Math.max(widestReach, graph.degree(node));
    worstSeverity = Math.max(worstSeverity, attributes.severity as number);
  });

  graph.forEachNode((node, attributes) => {
    const reach = Math.sqrt(graph.degree(node) / widestReach);
    const harm = (attributes.severity as number) / worstSeverity;
    const prominence = 0.55 * reach + 0.45 * harm;
    graph.setNodeAttribute(node, "size", MIN_SIZE + (MAX_SIZE - MIN_SIZE) * prominence);
    graph.setNodeAttribute(node, "prominence", prominence);
    graph.setNodeAttribute(node, "zIndex", Math.round(prominence * 100));
  });

  const ranked = graph
    .nodes()
    .sort((a, b) => (graph.getNodeAttribute(b, "prominence") as number)
      - (graph.getNodeAttribute(a, "prominence") as number));
  ranked.slice(0, ALWAYS_LABEL).forEach((node) => graph.setNodeAttribute(node, "forceLabel", true));
}

export function buildScene(document: GraphDocument): Graph {
  const graph = topology(document);
  const stored = hasStoredLayout(document);

  document.nodes.forEach((node, index) => {
    graph.mergeNodeAttributes(String(index), {
      label: nodeName(node),
      nodeType: node.type,
      band: node.band,
      verify: node.type === "SECRET" ? (node.validated ? (node.valid ? "live" : "dead") : "format") : null,
      severity: node.severity,
      color: BAND_COLOR[node.band] ?? INK.muted,
      borderColor: TYPE_COLOR[node.type] ?? INK.muted,
      size: MIN_SIZE,
      ...(stored ? { x: node.x, y: node.y } : {}),
    });
  });
  graph.forEachEdge((edge) => graph.mergeEdgeAttributes(edge, { size: 0.9, color: EDGE_COLOR }));

  rank(graph);
  if (!stored) {
    settle(graph);
  }
  return graph;
}

export type ColorMode = "severity" | "type";

export function nodeColor(node: { type: string; band: string }, mode: ColorMode): string {
  return mode === "severity"
    ? (BAND_COLOR[node.band] ?? TYPE_COLOR[node.type] ?? INK.muted)
    : (TYPE_COLOR[node.type] ?? BAND_COLOR[node.band] ?? INK.muted);
}

export function categoryColor(kind: string): string {
  return CATEGORY_COLOR[kind] ?? INK.muted;
}

export function categorySize(count: number, widest: number): number {
  const scale = Math.sqrt(count / Math.max(1, widest));
  return MIN_SIZE + (MAX_SIZE - MIN_SIZE) * scale;
}

export function buildCategoryScene(document: { nodes: CategoryNode[]; edges: CategoryEdge[] }): Graph {
  const graph = new Graph();
  const widest = Math.max(1, ...document.nodes.map((node) => node.count));
  document.nodes.forEach((node, index) => {
    graph.addNode(String(index), {
      label: `${node.label} (${node.count})`,
      nodeType: node.kind,
      color: categoryColor(node.kind),
      borderColor: categoryColor(node.kind),
      size: categorySize(node.count, widest),
      x: Math.cos(index) * (1 + (index % 7)),
      y: Math.sin(index) * (1 + (index % 5)),
      forceLabel: true,
    });
  });
  document.edges.forEach((edge) => {
    if (!graph.hasEdge(String(edge.s), String(edge.t))) {
      graph.addEdge(String(edge.s), String(edge.t), { size: 0.9, color: EDGE_COLOR, weight: edge.weight });
    }
  });
  settle(graph);
  return graph;
}
