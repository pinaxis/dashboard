import { settle, topology } from "../../src/graph/settle.ts";

const round = (value) => Math.round(value * 100) / 100;

export function withLayout(document) {
  const graph = topology(document);
  settle(graph);
  const nodes = document.nodes.map((node, index) => {
    const { x, y } = graph.getNodeAttributes(String(index));
    return { ...node, x: round(x), y: round(y) };
  });
  return { ...document, nodes };
}
