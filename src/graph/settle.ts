import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { GraphDocument } from "../data/graph";

/**
 * @remarks imported by the browser bundle and, through Node's type stripping, by the build's
 * layout step, so the precomputed and in-browser layouts share one set of settings. That is why it
 * may use only erasable syntax and must not import a sibling module at runtime (a type-only import
 * is erased, so it is safe).
 */
export function seedPosition(index: number): { x: number; y: number } {
  return { x: Math.cos(index) * (1 + (index % 7)), y: Math.sin(index) * (1 + (index % 5)) };
}

export function topology(document: GraphDocument): Graph {
  const graph = new Graph();
  document.nodes.forEach((_, index) => graph.addNode(String(index), seedPosition(index)));
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
    graph.addEdge(String(edge.s), String(edge.t), { edgeType: edge.type });
  });
  return graph;
}

export function settle(graph: Graph): void {
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

export function hasStoredLayout(document: GraphDocument): boolean {
  return document.nodes.length > 0
    && document.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
}
