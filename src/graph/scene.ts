import Graph from "graphology";
import type { CategoryEdge, CategoryNode, GraphDocument } from "../data/graph.ts";
import { nodeName } from "../data/graph.ts";
import { BAND_COLOR, CATEGORY_COLOR, TYPE_COLOR, INK, SURFACE } from "../lib/palette.ts";
import { hasStoredLayout, settle, topology } from "./settle.ts";

const MIN_SIZE = 2.5;
const MAX_SIZE = 30;
const EDGE_COLOR = "#2b2a27";
const ALWAYS_LABEL = 24;

// Severity sets the base radius so the dangerous few stand out of the tens of thousands of low-risk
// nodes; connection reach is only a secondary bump within a band. A high node with no reach is still
// larger than a low node at full reach.
const BAND_SIZE: Record<string, number> = { CRITICAL: 26, HIGH: 20, MEDIUM: 9, LOW: 2.5 };
const BAND_TIER: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const BAND_WEIGHT: Record<string, number> = { CRITICAL: 1, HIGH: 0.85, MEDIUM: 0.5, LOW: 0.15 };
const REACH_BONUS = 6;

export function nodeSize(band: string, reach: number): number {
  const bounded = Math.max(0, Math.min(1, reach));
  return (BAND_SIZE[band] ?? BAND_SIZE.LOW) + bounded * REACH_BONUS;
}

// How much a node earns a place at the overview: the stronger of how severe it is and how connected
// it is, so the dangerous nodes and the big hubs survive a zoom-out while the peripheral mass drops.
export function importance(band: string, reach: number): number {
  const bounded = Math.max(0, Math.min(1, reach));
  return Math.max(BAND_WEIGHT[band] ?? BAND_WEIGHT.LOW, bounded);
}

// The importance a node needs to be drawn at the current zoom. Wide out shows only the exposures and
// hubs; each step in reveals more, until a deep zoom draws everything. Quantized so it changes only
// when the camera crosses a step, never every frame.
export function thresholdForZoom(ratio: number): number {
  if (ratio >= 2) {
    return 0.6;
  }
  if (ratio >= 0.8) {
    return 0.45;
  }
  if (ratio >= 0.3) {
    return 0.16;
  }
  return 0;
}

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16)) as [number, number, number];
}

function mix(hex: string, target: string, amount: number): string {
  const from = channels(hex);
  const to = channels(target);
  const blended = from.map((value, index) => Math.round(value + (to[index] - value) * amount));
  return "#" + blended.map((value) => value.toString(16).padStart(2, "0")).join("");
}

// A low-severity node's fill is pulled most of the way to the background so the 45k low nodes recede
// into texture and the high and medium exposures read as the signal.
export function severityFill(band: string, color: string): string {
  return band === "LOW" ? mix(color, SURFACE, 0.6) : color;
}

// Severity drives size and z-order so the dangerous nodes dominate the overview; reach only breaks
// ties within a band. Every high and critical node is labelled outright, and the largest nodes beyond
// those get a label too so the hubs stay readable.
function rank(graph: Graph): void {
  let widestReach = 1;
  graph.forEachNode((node) => {
    widestReach = Math.max(widestReach, graph.degree(node));
  });

  graph.forEachNode((node, attributes) => {
    const band = attributes.band as string;
    const reach = Math.sqrt(graph.degree(node) / widestReach);
    graph.setNodeAttribute(node, "size", nodeSize(band, reach));
    graph.setNodeAttribute(node, "importance", importance(band, reach));
    graph.setNodeAttribute(node, "zIndex", (BAND_TIER[band] ?? 1) * 1000 + Math.round(reach * 100));
    if (band === "HIGH" || band === "CRITICAL") {
      graph.setNodeAttribute(node, "forceLabel", true);
    }
  });

  const ranked = graph
    .nodes()
    .sort((a, b) => (graph.getNodeAttribute(b, "size") as number) - (graph.getNodeAttribute(a, "size") as number));
  ranked.slice(0, ALWAYS_LABEL).forEach((node) => graph.setNodeAttribute(node, "forceLabel", true));
}

export function buildScene(document: GraphDocument): Graph {
  const graph = topology(document);
  const stored = hasStoredLayout(document);

  document.nodes.forEach((node, index) => {
    const bandColor = BAND_COLOR[node.band] ?? INK.muted;
    const typeColor = TYPE_COLOR[node.type] ?? INK.muted;
    const sevColor = severityFill(node.band, bandColor);
    graph.mergeNodeAttributes(String(index), {
      label: nodeName(node),
      nodeType: node.type,
      band: node.band,
      verify: node.type === "SECRET" ? (node.validated ? (node.valid ? "live" : "dead") : "format") : null,
      severity: node.severity,
      color: sevColor,
      borderColor: typeColor,
      sevColor,
      sevBorder: bandColor,
      typeColor: severityFill(node.band, typeColor),
      typeBorder: typeColor,
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
