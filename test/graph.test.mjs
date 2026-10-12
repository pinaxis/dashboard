import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildGraph } from "../scripts/lib/graph.mjs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const initSqlJs = require("sql.js");
const SQL = await initSqlJs();

function open() {
  return new SQL.Database(readFileSync(join(root, "scratch", "fixture.db")));
}

function build() {
  const db = open();
  try {
    return buildGraph(db, { schemaVersion: 4 });
  } finally {
    db.close();
  }
}

const find = (graph, type) => graph.nodes.filter((node) => node.type === type);
const pairs = (graph, type, left, right) => graph.edges
  .filter((edge) => edge.type === type)
  .map((edge) => [left(graph.nodes[edge.s]), right(graph.nodes[edge.t])])
  .sort();
const label = (node) => node.label;
const target = (node) => node.target;

test("maintainer nodes keep their real logins", () => {
  assert.deepEqual(find(build(), "MAINTAINER").map((n) => n.label).sort(),
    ["asmith", "jdoe"]);
});

test("maintains and co-maintains edges are kept", () => {
  const types = new Set(build().edges.map((edge) => edge.type));
  assert.ok(types.has("MAINTAINS"));
  assert.ok(types.has("CO_MAINTAINS"));
});

test("a secret node carries a masked value, not the raw one", () => {
  const secret = find(build(), "SECRET").find((n) => n.target === "github-token");
  assert.ok(secret.value.includes("…"), "private value is not masked");
  assert.ok(!secret.value.includes("aaaaaaaaaaaabbbb"), "private value leaked the raw secret body");
});

test("repositories and owners carry real names", () => {
  const graph = build();
  assert.deepEqual(find(graph, "REPOSITORY").map((n) => n.label).sort(), ["acme/api", "acme/web"]);
  assert.deepEqual(find(graph, "OWNER").map((n) => n.label), ["acme"]);
});

test("one FILE node per repository and path, shared by two leaks in one file", () => {
  const graph = build();
  assert.deepEqual(find(graph, "FILE").map(label).sort(),
    ["deep\\win\\notes.txt", "deep\\win\\v1.2\\dist\\config", "package.json", "src/config/.env"]);
  const envIndex = graph.nodes.findIndex((node) => node.type === "FILE" && node.label === "src/config/.env");
  assert.equal(graph.edges.filter((edge) => edge.type === "LEAKED_IN" && edge.t === envIndex).length, 2);
});

test("a leak points at its file, and a leak with no path keeps its direct edge", () => {
  assert.deepEqual(pairs(build(), "LEAKED_IN", target, label), [
    ["gcp-api-key", "acme/web"],
    ["gcp-api-key", "deep\\win\\v1.2\\dist\\config"],
    ["github-token", "src/config/.env"],
    ["openai-api-key", "deep\\win\\notes.txt"],
    ["openai-api-key", "src/config/.env"],
  ]);
});

test("a repository contains each of its files exactly once", () => {
  assert.deepEqual(pairs(build(), "CONTAINS", label, label), [
    ["acme/api", "deep\\win\\notes.txt"],
    ["acme/api", "src/config/.env"],
    ["acme/web", "deep\\win\\v1.2\\dist\\config"],
    ["acme/web", "package.json"],
  ]);
});

test("a package's USED_IN points at the manifest file", () => {
  assert.deepEqual(pairs(build(), "USED_IN", label, label), [["react", "package.json"]]);
});

test("a FILE carries its full path", () => {
  for (const file of find(build(), "FILE")) {
    assert.equal(file.path, file.label);
  }
});

test("no path-bearing edge carries a context", () => {
  for (const edge of build().edges.filter((e) => e.type === "LEAKED_IN" || e.type === "USED_IN")) {
    assert.ok(!("context" in edge), `${edge.type} edge kept a context`);
  }
});

test("a FILE takes the worst severity and band of its leaks", () => {
  const files = new Map(find(build(), "FILE").map((file) => [file.label, file]));
  assert.equal(files.get("src/config/.env").severity, 90);
  assert.equal(files.get("src/config/.env").band, "CRITICAL");
  assert.equal(files.get("deep\\win\\v1.2\\dist\\config").severity, 40);
  assert.equal(files.get("deep\\win\\v1.2\\dist\\config").band, "LOW");
  assert.equal(files.get("deep\\win\\v1.2\\dist\\config").firstSeen, "2026-09-15T10:00:00Z");
});

test("a CONTAINS edge carries weight 1 and its file's severity", () => {
  const graph = build();
  for (const edge of graph.edges.filter((e) => e.type === "CONTAINS")) {
    assert.equal(edge.weight, 1);
    assert.equal(edge.severity, graph.nodes[edge.t].severity);
  }
});
test("the document is built in private mode", () => {
  assert.equal(build().mode, "private");
});

test("an empty context is omitted rather than emitted blank", () => {
  const ownedBy = build().edges.find((edge) => edge.type === "OWNED_BY");
  assert.ok(!("context" in ownedBy));
});

test("an OWNED_BY edge keeps its non-empty context", () => {
  const ownedByEdges = build().edges.filter((edge) => edge.type === "OWNED_BY");
  assert.ok(ownedByEdges.some((edge) => edge.context === "github:acme/api"),
    "private OWNED_BY lost its context");
});

test("edge endpoints index into the emitted node array", () => {
  const graph = build();
  for (const edge of graph.edges) {
    assert.ok(graph.nodes[edge.s] !== undefined, "edge source out of range");
    assert.ok(graph.nodes[edge.t] !== undefined, "edge target out of range");
  }
});

test("a repository carries its maintainer count", () => {
  const counts = find(build(), "REPOSITORY").map((n) => n.maintainers).sort();
  assert.deepEqual(counts, [0, 2]);
});

test("stats count nodes and edges by type", () => {
  const stats = build().stats;
  assert.equal(stats.nodes.SECRET, 3);
  assert.equal(stats.nodes.MAINTAINER, 2);
  assert.equal(stats.edges.LEAKED_IN, 5);
});

test("stats split credentials into validated live, validated dead and format only", () => {
  const credentials = build().stats.credentials;
  const byTarget = new Map(credentials.map((row) => [row.target, row]));
  assert.deepEqual(byTarget.get("openai-api-key"), { target: "openai-api-key", validatedLive: 1, validatedDead: 0, formatOnly: 0 });
  assert.deepEqual(byTarget.get("github-token"), { target: "github-token", validatedLive: 0, validatedDead: 1, formatOnly: 0 });
  assert.deepEqual(byTarget.get("gcp-api-key"), { target: "gcp-api-key", validatedLive: 0, validatedDead: 0, formatOnly: 1 });
});

test("co-occurrence pairs secret types sharing a repository, and names none", () => {
  const pairs = build().stats.coOccurrence;
  assert.deepEqual(pairs, [{ a: "github-token", b: "openai-api-key", repositories: 1 }]);
});

const tally = (items, keyOf) => items.reduce((out, item) => {
  out[keyOf(item)] = (out[keyOf(item)] ?? 0) + 1;
  return out;
}, {});

test("stats count exactly the emitted nodes and edges", () => {
  const graph = build();
  assert.deepEqual(graph.stats.nodes, tally(graph.nodes, (node) => node.type));
  assert.deepEqual(graph.stats.edges, tally(graph.edges, (edge) => edge.type));
  assert.deepEqual(graph.stats.bands, tally(graph.nodes, (node) => node.band));
});

test("stats count maintainers and follows", () => {
  const { stats } = build();
  assert.equal(stats.nodes.MAINTAINER, 2);
  assert.equal(stats.edges.FOLLOWS, 1);
  assert.equal(stats.nodes.FILE, 4);
  assert.equal(stats.edges.CONTAINS, 4);
});

test("lastSeen is the latest sighting among emitted nodes", () => {
  const graph = build();
  assert.equal(graph.stats.lastSeen, graph.nodes.map((node) => node.lastSeen).sort().at(-1));
});

test("an empty database reports no lastSeen", () => {
  assert.equal(buildMini("").stats.lastSeen, null);
});

const MINI_SCHEMA = `
  CREATE TABLE node (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', key TEXT NOT NULL,
    label TEXT, category TEXT, valid INTEGER, platform TEXT, props TEXT,
    popularity INTEGER, severity REAL NOT NULL DEFAULT 0, severity_band TEXT NOT NULL DEFAULT 'LOW',
    first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);
  CREATE TABLE edge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    src INTEGER NOT NULL, dst INTEGER NOT NULL, type TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '', weight INTEGER NOT NULL DEFAULT 1,
    severity REAL NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);`;

function buildMini(inserts) {
  const db = new SQL.Database();
  db.run(MINI_SCHEMA + inserts);
  try {
    return buildGraph(db, { schemaVersion: 99 });
  } finally {
    db.close();
  }
}

function withUnhandledNodeType() {
  return buildMini(`
    INSERT INTO node (type, target, key, label, severity, severity_band, first_seen, last_seen)
      VALUES ('CONTRIBUTOR', '', 'github:ghost', 'ghost', 10, 'LOW',
        '2026-09-14T10:00:00Z', '2026-09-14T10:00:00Z');`);
}

test("a node type with no special handling is still emitted", () => {
  const graph = withUnhandledNodeType();
  assert.deepEqual(find(graph, "CONTRIBUTOR").map((n) => n.label), ["ghost"]);
});

const MULTI_PLATFORM = `
  INSERT INTO node (type, target, key, label, platform, severity, severity_band, first_seen, last_seen) VALUES
    ('REPOSITORY', '', 'github:acme/api', 'acme/api', 'github', 90, 'CRITICAL', '2026-09-14T10:00:00Z', '2026-09-16T10:00:00Z'),
    ('REPOSITORY', '', 'gitlab:acme/web', 'acme/web', 'gitlab', 40, 'LOW', '2026-09-15T10:00:00Z', '2026-09-15T10:00:00Z'),
    ('REPOSITORY', '', 'unknown:acme/old', 'acme/old', NULL, 10, 'LOW', '2026-09-13T10:00:00Z', '2026-09-13T10:00:00Z');`;

test("one platform emits no PLATFORM node and no HOSTED_ON edge", () => {
  const graph = build();
  assert.equal(find(graph, "PLATFORM").length, 0, "emitted a lone platform");
  assert.ok(!graph.edges.some((edge) => edge.type === "HOSTED_ON"), "emitted HOSTED_ON");
});

test("two platforms emit one PLATFORM each and host every repository on its own", () => {
  const graph = buildMini(MULTI_PLATFORM);
  assert.deepEqual(find(graph, "PLATFORM").map(label), ["github", "gitlab"]);
  assert.deepEqual(pairs(graph, "HOSTED_ON", label, label),
    [["acme/api", "github"], ["acme/web", "gitlab"]]);
});

test("a repository with no platform is neither hosted nor counted as a platform", () => {
  const graph = buildMini(MULTI_PLATFORM);
  assert.equal(find(graph, "PLATFORM").length, 2);
  assert.ok(!pairs(graph, "HOSTED_ON", label, label).some(([repository]) => repository === "acme/old"));
});

test("a PLATFORM spans its repositories' sightings at zero severity", () => {
  const github = find(buildMini(MULTI_PLATFORM), "PLATFORM").find((node) => node.label === "github");
  assert.deepEqual(
    { severity: github.severity, band: github.band, firstSeen: github.firstSeen, lastSeen: github.lastSeen },
    { severity: 0, band: "LOW", firstSeen: "2026-09-14T10:00:00Z", lastSeen: "2026-09-16T10:00:00Z" });
});

