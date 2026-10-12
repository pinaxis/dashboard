import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildPublicGraph, defaultPolicy } from "../scripts/lib/public.mjs";
import { assertPublicSafe } from "../scripts/assert-public-safe.mjs";

const require = createRequire(import.meta.url);
const SQL = await require("sql.js")();
const NOW = Date.UTC(2026, 8, 1);

const OLD_A = "2026-06-10T10:00:00.000000000Z";
const OLD_B = "2026-07-10T10:00:00.000000000Z";
const RECENT = "2026-08-20T10:00:00.000000000Z";

/**
 * A public-only fixture built in memory, so the shape and counts the aggregates need do not perturb
 * the shared private fixture. Each leak is its own secret and repository, as the real graph is.
 */
function fixture() {
  const db = new SQL.Database();
  db.run(`CREATE TABLE node (id INTEGER PRIMARY KEY, type TEXT, target TEXT DEFAULT '', valid INTEGER,
            props TEXT, severity_band TEXT, first_seen TEXT);
          CREATE TABLE edge (id INTEGER PRIMARY KEY, src INTEGER, dst INTEGER, type TEXT, context TEXT);`);
  let id = 0;
  const leak = (target, band, valid, validated, when, extension) => {
    const secret = (id += 1);
    db.run("INSERT INTO node VALUES (?,?,?,?,?,?,?)",
      [secret, "SECRET", target, valid, JSON.stringify({ validated }), band, when]);
    const repo = (id += 1);
    db.run("INSERT INTO node VALUES (?,?,?,?,?,?,?)", [repo, "REPOSITORY", "", null, "{}", band, when]);
    db.run("INSERT INTO edge VALUES (?,?,?,?,?)", [secret, secret, repo, "LEAKED_IN", `src/app${extension}`]);
  };
  const many = (n, ...rest) => { for (let i = 0; i < n; i += 1) leak(...rest); };
  many(6, "openai-api-key", "CRITICAL", 1, true, OLD_A, ".env");
  many(4, "aws-access-key", "HIGH", 0, true, OLD_A, ".env");
  many(3, "aws-access-key", "HIGH", 0, true, OLD_B, ".yml");
  many(4, "gcp-api-key", "LOW", 0, false, OLD_A, ".json");
  many(2, "openai-api-key", "CRITICAL", 1, true, RECENT, ".env");
  return db;
}

function build(now = NOW) {
  const db = fixture();
  try {
    return buildPublicGraph(db, defaultPolicy(now));
  } finally {
    db.close();
  }
}

const bucket = (stats, field, label) => stats[field].find((entry) => entry.label === label);

test("the document is public and carries only category nodes", () => {
  const graph = build();
  assert.equal(graph.mode, "public");
  assert.ok(graph.nodes.length > 0);
  for (const node of graph.nodes) {
    assert.equal(node.type, "CATEGORY");
    assert.deepEqual(Object.keys(node).sort(), ["count", "kind", "label", "type"]);
  }
});

test("a credential type at or above five stands; gcp folds and the sub-five other is dropped", () => {
  const stats = build().stats;
  assert.equal(bucket(stats, "byCredential", "openai-api-key").count, 6);
  assert.equal(bucket(stats, "byCredential", "aws-access-key").count, 7);
  assert.equal(bucket(stats, "byCredential", "gcp-api-key"), undefined);
  assert.equal(bucket(stats, "byCredential", "other"), undefined);
});

test("recent findings are excluded by the delay", () => {
  assert.equal(bucket(build().stats, "byCredential", "openai-api-key").count, 6);
  const later = build(Date.UTC(2026, 9, 1)).stats;
  assert.equal(bucket(later, "byCredential", "openai-api-key").count, 8);
});

test("a folded extension bucket survives when it totals at least five", () => {
  const stats = build().stats;
  assert.equal(bucket(stats, "byExtension", ".env").count, 10);
  assert.equal(bucket(stats, "byExtension", ".yml"), undefined);
  assert.equal(bucket(stats, "byExtension", "other").count, 7);
});

test("validity splits, suppressing a sub-five part to zero", () => {
  const validity = build().stats.validity;
  assert.equal(validity.live, 6);
  assert.equal(validity.dead, 7);
  assert.equal(validity.formatOnly, 0);
});

test("monthly trend keeps months of five or more and labels them by UTC month", () => {
  const months = build().stats.monthly.map((entry) => [entry.month, entry.found]);
  assert.deepEqual(months, [["2026-06", 14]]);
});

test("a headline total is the sum of surviving credential buckets, not the raw total", () => {
  const stats = build().stats;
  const shown = stats.byCredential.reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(stats.total, shown);
  assert.equal(stats.total, 13);
});

test("asOf is the day-rounded cutoff and no clock timestamp survives", () => {
  const graph = build();
  assert.equal(graph.stats.asOf, "2026-08-02");
  assert.equal(JSON.stringify(graph).match(/\d{4}-\d\d-\d\dT/), null);
});

test("a category edge below weight five is dropped, and a surviving one links its categories", () => {
  const graph = build();
  for (const edge of graph.edges) {
    assert.ok(edge.weight >= 5);
  }
  const label = (index) => graph.nodes[index].label;
  const pairs = graph.edges.map((edge) => [label(edge.s), label(edge.t)].sort().join(" "));
  assert.ok(pairs.includes(".env openai-api-key"));
});

test("a populated public document passes the gate on non-empty, aged data", () => {
  const graph = build();
  assert.ok(graph.nodes.length > 0, "the aged fixture must produce category nodes");
  const document = { mode: "public", schema: 5, dataset: "dataset-v5", generatedAt: "2026-09-01", ...graph };
  assert.doesNotThrow(() => assertPublicSafe(document));
});

test("a finding leaked into two files counts once per extension, not twice toward one", () => {
  const db = new SQL.Database();
  db.run(`CREATE TABLE node (id INTEGER PRIMARY KEY, type TEXT, target TEXT DEFAULT '', valid INTEGER,
            props TEXT, severity_band TEXT, first_seen TEXT);
          CREATE TABLE edge (id INTEGER PRIMARY KEY, src INTEGER, dst INTEGER, type TEXT, context TEXT);
          INSERT INTO node VALUES (1,'SECRET','openai-api-key',1,'{"validated":true}','CRITICAL','2026-06-01T00:00:00Z');
          INSERT INTO node VALUES (2,'REPOSITORY','',NULL,'{}','CRITICAL','2026-06-01T00:00:00Z');
          INSERT INTO edge VALUES (1,1,2,'LEAKED_IN','src/.env');
          INSERT INTO edge VALUES (2,1,2,'LEAKED_IN','src/app.pem');`);
  const policy = { ...defaultPolicy(Date.UTC(2026, 8, 1)), minGroup: 1 };
  const stats = buildPublicGraph(db, policy).stats;
  db.close();
  assert.equal(bucket(stats, "byCredential", "openai-api-key").count, 1);
  assert.equal(bucket(stats, "byExtension", ".env").count, 1);
  assert.equal(bucket(stats, "byExtension", ".pem").count, 1);
});
