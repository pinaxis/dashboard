import { test } from "node:test";
import assert from "node:assert/strict";
import { withLayout } from "../scripts/lib/layout.mjs";

const node = (label) => ({ type: "REPOSITORY", severity: 1, band: "LOW", firstSeen: "x", lastSeen: "y",
  label, maintainers: 0 });
const edge = (s, t) => ({ s, t, type: "OWNED_BY", weight: 1, severity: 1 });

function document() {
  return {
    mode: "public", schema: 5,
    nodes: [node("a"), node("b"), node("c"), node("isolated")],
    edges: [edge(0, 1), edge(1, 2)],
    stats: { nodes: {}, edges: {}, bands: {}, credentials: [], coOccurrence: [], lastSeen: null },
  };
}

test("every node, an isolated one included, gets finite rounded x and y", () => {
  for (const laid of withLayout(document()).nodes) {
    assert.ok(Number.isFinite(laid.x) && Number.isFinite(laid.y), `${laid.label} has no position`);
    assert.equal(laid.x, Math.round(laid.x * 100) / 100);
    assert.equal(laid.y, Math.round(laid.y * 100) / 100);
  }
});

test("the same document lays out identically twice", () => {
  assert.deepEqual(withLayout(document()), withLayout(document()));
});

test("layout keeps every other field and leaves the input untouched", () => {
  const input = document();
  const laid = withLayout(input);
  assert.ok(!("x" in input.nodes[0]), "withLayout mutated its input");
  assert.deepEqual(laid.edges, input.edges);
  assert.deepEqual({ ...laid.nodes[0], x: undefined, y: undefined }, { ...input.nodes[0], x: undefined, y: undefined });
});

test("an empty document lays out to an empty document", () => {
  const empty = { ...document(), nodes: [], edges: [] };
  assert.deepEqual(withLayout(empty).nodes, []);
});
