import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exposuresOverTime, byCategory, byFileType, validityTotals, applyFilter, secretValidity,
} from "../src/data/chartSeries.ts";

function doc(nodes) {
  return {
    mode: "private", schema: 5, nodes, edges: [],
    stats: { nodes: {}, edges: {}, bands: {}, credentials: [], coOccurrence: [], lastSeen: null },
  };
}
const secret = (over) => ({ type: "SECRET", severity: 10, band: "LOW", firstSeen: "2026-10-01T00:00:00Z", lastSeen: "2026-10-01T00:00:00Z", target: "github-token", category: "vcs", valid: false, validated: false, ...over });
const file = (over) => ({ type: "FILE", severity: 1, band: "LOW", firstSeen: "2026-10-01T00:00:00Z", lastSeen: "2026-10-01T00:00:00Z", label: "f", ...over });

test("exposuresOverTime buckets by day with a running cumulative and skips bad firstSeen", () => {
  const nodes = [
    secret({ firstSeen: "2026-10-01T05:00:00Z", band: "CRITICAL" }),
    secret({ firstSeen: "2026-10-01T22:00:00Z", band: "LOW" }),
    secret({ firstSeen: "2026-10-03T01:00:00Z", band: "CRITICAL" }),
    secret({ firstSeen: "not-a-date" }),
    secret({ firstSeen: "" }),
  ];
  const series = exposuresOverTime(doc(nodes), "day");
  assert.deepEqual(series.map((p) => p.at), ["2026-10-01", "2026-10-03"]);
  assert.equal(series[0].found, 2);
  assert.equal(series[0].critical, 1);
  assert.equal(series[0].cumulative, 2);
  assert.equal(series[1].cumulative, 3);
});

test("byFileType folds a missing or extensionless path to other", () => {
  const bars = byFileType(doc([
    file({ path: "a/b/config.env" }),
    file({ path: "a/b/config.env" }),
    file({ path: "Dockerfile" }),
    file({ path: undefined }),
  ]));
  const map = Object.fromEntries(bars.map((b) => [b.label, b.value]));
  assert.equal(map.env, 2);
  assert.equal(map.other, 2);
});

test("byCategory folds a null category to uncategorized", () => {
  const bars = byCategory(doc([secret({ category: null }), secret({ category: "vcs" }), secret({ category: "vcs" })]));
  const map = Object.fromEntries(bars.map((b) => [b.label, b.value]));
  assert.equal(map.uncategorized, 1);
  assert.equal(map.vcs, 2);
});

test("secretValidity maps valid/validated to live, dead, or format", () => {
  assert.equal(secretValidity(secret({ valid: true, validated: true })), "live");
  assert.equal(secretValidity(secret({ valid: false, validated: true })), "dead");
  assert.equal(secretValidity(secret({ valid: false, validated: false })), "format");
});

test("applyFilter with every dimension empty returns all nodes", () => {
  const nodes = [secret({}), file({})];
  const out = applyFilter(doc(nodes), { bands: new Set(), types: new Set(), validity: new Set() });
  assert.equal(out.nodes.length, 2);
});

test("applyFilter drops edges whose endpoints are filtered out and remaps the survivors", () => {
  const repo = { type: "REPOSITORY", severity: 1, band: "LOW", firstSeen: "2026-10-01T00:00:00Z", lastSeen: "2026-10-01T00:00:00Z", label: "o/r", maintainers: 0 };
  const nodes = [secret({}), file({ path: "a/b.env" }), repo];
  const edges = [
    { s: 0, t: 1, type: "LEAKED_IN", weight: 1, severity: 1 },
    { s: 2, t: 1, type: "CONTAINS", weight: 1, severity: 1 },
  ];
  const source = { ...doc(nodes), edges };
  const view = applyFilter(source, { bands: new Set(), types: new Set(["FILE", "REPOSITORY"]), validity: new Set() });
  assert.equal(view.nodes.length, 2);
  assert.equal(view.edges.length, 1);
  const edge = view.edges[0];
  assert.equal(view.nodes[edge.s].type, "REPOSITORY");
  assert.equal(view.nodes[edge.t].type, "FILE");
});

test("applyFilter with no filter leaves edge indices identical to the source", () => {
  const repo = { type: "REPOSITORY", severity: 1, band: "LOW", firstSeen: "2026-10-01T00:00:00Z", lastSeen: "2026-10-01T00:00:00Z", label: "o/r", maintainers: 0 };
  const nodes = [secret({}), repo];
  const edges = [{ s: 0, t: 1, type: "LEAKED_IN", weight: 1, severity: 1 }];
  const view = applyFilter({ ...doc(nodes), edges }, { bands: new Set(), types: new Set(), validity: new Set() });
  assert.deepEqual(view.edges, edges);
});

test("applyFilter narrows by band, type, and validity; non-secret passes the validity dimension", () => {
  const nodes = [
    secret({ band: "CRITICAL", valid: true, validated: true }),
    secret({ band: "LOW", valid: false, validated: false }),
    file({ band: "CRITICAL" }),
  ];
  const byBand = applyFilter(doc(nodes), { bands: new Set(["CRITICAL"]), types: new Set(), validity: new Set() });
  assert.equal(byBand.nodes.length, 2);
  const byType = applyFilter(doc(nodes), { bands: new Set(), types: new Set(["SECRET"]), validity: new Set() });
  assert.equal(byType.nodes.length, 2);
  const byValidity = applyFilter(doc(nodes), { bands: new Set(), types: new Set(), validity: new Set(["live"]) });
  assert.equal(byValidity.nodes.length, 2);
});
