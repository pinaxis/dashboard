import { test } from "node:test";
import assert from "node:assert/strict";
import { hasStoredLayout, seedPosition, topology } from "../src/graph/settle.ts";

const node = (extra = {}) => ({ type: "REPOSITORY", severity: 1, band: "LOW", firstSeen: "x", lastSeen: "y",
  label: "r", maintainers: 0, ...extra });
const edge = (s, t, type = "OWNED_BY") => ({ s, t, type, weight: 1, severity: 1 });
const document = (nodes, edges = []) => ({ mode: "public", schema: 5, nodes, edges,
  stats: { nodes: {}, edges: {}, bands: {}, credentials: [], coOccurrence: [], lastSeen: null } });

test("topology drops self-loops and collapses parallel and reverse edges", () => {
  const graph = topology(document([node(), node(), node()],
    [edge(0, 1), edge(0, 1, "LEAKED_IN"), edge(1, 0), edge(2, 2), edge(1, 2)]));
  assert.equal(graph.order, 3);
  assert.equal(graph.size, 2);
});

test("topology skips an edge whose endpoint is out of range", () => {
  assert.equal(topology(document([node()], [edge(0, 5)])).size, 0);
});

test("topology seeds every node at its deterministic start", () => {
  const graph = topology(document([node(), node()]));
  assert.deepEqual(graph.getNodeAttributes("1"), seedPosition(1));
});

test("a stored layout needs finite x and y on every node", () => {
  assert.equal(hasStoredLayout(document([node({ x: 1, y: 2 }), node({ x: 0, y: 0 })])), true);
  assert.equal(hasStoredLayout(document([node({ x: 1, y: 2 }), node()])), false);
  assert.equal(hasStoredLayout(document([node({ x: Number.NaN, y: 2 })])), false);
  assert.equal(hasStoredLayout(document([])), false);
});
