import { test } from "node:test";
import assert from "node:assert/strict";
import { leaksPerRepository } from "../src/data/exposure.ts";

const node = (type) => ({ type, severity: 1, band: "LOW", firstSeen: "x", lastSeen: "y", label: type });
const edge = (s, t, type) => ({ s, t, type, weight: 1, severity: 1 });

function document() {
  return {
    mode: "public", schema: 5,
    nodes: [node("SECRET"), node("SECRET"), node("REPOSITORY"), node("FILE"), node("FILE"),
      node("REPOSITORY"), node("FILE")],
    edges: [
      edge(0, 3, "LEAKED_IN"), edge(1, 3, "LEAKED_IN"), edge(1, 4, "LEAKED_IN"),
      edge(2, 3, "CONTAINS"), edge(2, 4, "CONTAINS"),
      edge(0, 5, "LEAKED_IN"),
      edge(1, 6, "LEAKED_IN"),
    ],
    stats: { nodes: {}, edges: {}, bands: {}, credentials: [], coOccurrence: [], lastSeen: null },
  };
}

test("a leak into a file counts toward the repository containing it", () => {
  assert.equal(leaksPerRepository(document()).get(2), 3);
});

test("a leak straight into a repository still counts", () => {
  assert.equal(leaksPerRepository(document()).get(5), 1);
});

test("a leak into a file no repository contains counts toward nothing", () => {
  assert.deepEqual([...leaksPerRepository(document()).keys()].sort(), [2, 5]);
});
