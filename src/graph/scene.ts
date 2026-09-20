import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { GraphDocument } from "../data/graph";
import { nodeName } from "../data/graph";
import { BAND_COLOR, TYPE_COLOR, INK } from "../lib/palette";

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

function settle(graph: Graph): void {
  const settings = forceAtlas2.inferSettings(graph);
  forceAtlas2.assign(graph, {
    iterations: 500,
    settings: {
      ...settings,
      linLogMode: true,
      outboundAttractionDistribution: true,
      gravity: 1,
      scalingRatio: 10,
      barnesHutOptimize: graph.order > 200,
    },
  });
}

export function buildScene(document: GraphDocument): Graph {
  const graph = new Graph();

  document.nodes.forEach((node, index) => {
    graph.addNode(String(index), {
      label: nodeName(node),
      nodeType: node.type,
      band: node.band,
      verify: node.type === "SECRET" ? (node.validated ? (node.valid ? "live" : "dead") : "format") : null,
      severity: node.severity,
      color: BAND_COLOR[node.band] ?? INK.muted,
      borderColor: TYPE_COLOR[node.type] ?? INK.muted,
      x: Math.cos(index) * (1 + (index % 7)),
      y: Math.sin(index) * (1 + (index % 5)),
      size: MIN_SIZE,
    });
  });

  const drawn = new Set<string>();
  document.edges.forEach((edge) => {
    if (edge.s === edge.t) {
      return;
    }
    const from = Math.min(edge.s, edge.t);
    const to = Math.max(edge.s, edge.t);
    const key = `${from}-${to}`;
    if (drawn.has(key) || !graph.hasNode(String(from)) || !graph.hasNode(String(to))) {
      return;
    }
    drawn.add(key);
    graph.addEdge(String(edge.s), String(edge.t), { size: 0.9, color: EDGE_COLOR, edgeType: edge.type });
  });

  rank(graph);
  settle(graph);
  return graph;
}
