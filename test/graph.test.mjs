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

const pseudonym = (prefix, key) => `${prefix}-${Buffer.from(key).toString("hex").slice(-8)}`;

function build(mode) {
  const db = open();
  try {
    return buildGraph(db, { mode, pseudonym, schemaVersion: 4 });
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

test("public omits maintainer nodes entirely", () => {
  assert.equal(find(build("public"), "MAINTAINER").length, 0);
});

test("private keeps maintainer nodes with real logins", () => {
  assert.deepEqual(find(build("private"), "MAINTAINER").map((n) => n.label).sort(),
    ["asmith", "jdoe"]);
});

test("public omits maintains and co-maintains edges", () => {
  const types = new Set(build("public").edges.map((edge) => edge.type));
  assert.ok(!types.has("MAINTAINS"), "MAINTAINS reached the public graph");
  assert.ok(!types.has("CO_MAINTAINS"), "CO_MAINTAINS reached the public graph");
  assert.ok(!types.has("FOLLOWS"), "FOLLOWS reached the public graph");
});

test("private keeps maintains and co-maintains edges", () => {
  const types = new Set(build("private").edges.map((edge) => edge.type));
  assert.ok(types.has("MAINTAINS"));
  assert.ok(types.has("CO_MAINTAINS"));
});

test("a public secret node carries no value bearing field at all", () => {
  for (const secret of find(build("public"), "SECRET")) {
    for (const field of ["key", "label", "value"]) {
      assert.ok(!(field in secret), `public secret exposed ${field}`);
    }
  }
});

test("a private secret node carries a masked value, not the raw one", () => {
  const secret = find(build("private"), "SECRET").find((n) => n.target === "github-token");
  assert.ok(secret.value.includes("…"), "private value is not masked");
  assert.ok(!secret.value.includes("aaaaaaaaaaaabbbb"), "private value leaked the raw secret body");
});

test("public repositories and owners are pseudonymous", () => {
  const graph = build("public");
  for (const node of [...find(graph, "REPOSITORY"), ...find(graph, "OWNER")]) {
    assert.match(node.label, /^(repo|owner)-[0-9a-f]{8}$/);
  }
});

test("private repositories and owners carry real names", () => {
  const graph = build("private");
  assert.deepEqual(find(graph, "REPOSITORY").map((n) => n.label).sort(), ["acme/api", "acme/web"]);
  assert.deepEqual(find(graph, "OWNER").map((n) => n.label), ["acme"]);
});

test("package names stay real in public, being registry identifiers", () => {
  assert.deepEqual(find(build("public"), "PACKAGE").map((n) => n.label), ["react"]);
});

test("one FILE node per repository and path, shared by two leaks in one file", () => {
  const graph = build("private");
  assert.deepEqual(find(graph, "FILE").map(label).sort(),
    ["deep\\win\\notes.txt", "deep\\win\\v1.2\\dist\\config", "package.json", "src/config/.env"]);
  const envIndex = graph.nodes.findIndex((node) => node.type === "FILE" && node.label === "src/config/.env");
  assert.equal(graph.edges.filter((edge) => edge.type === "LEAKED_IN" && edge.t === envIndex).length, 2);
});

test("a leak points at its file, and a leak with no path keeps its direct edge", () => {
  assert.deepEqual(pairs(build("private"), "LEAKED_IN", target, label), [
    ["gcp-api-key", "acme/web"],
    ["gcp-api-key", "deep\\win\\v1.2\\dist\\config"],
    ["github-token", "src/config/.env"],
    ["openai-api-key", "deep\\win\\notes.txt"],
    ["openai-api-key", "src/config/.env"],
  ]);
});

test("a repository contains each of its files exactly once", () => {
  assert.deepEqual(pairs(build("private"), "CONTAINS", label, label), [
    ["acme/api", "deep\\win\\notes.txt"],
    ["acme/api", "src/config/.env"],
    ["acme/web", "deep\\win\\v1.2\\dist\\config"],
    ["acme/web", "package.json"],
  ]);
});

test("a package's USED_IN points at the manifest file", () => {
  assert.deepEqual(pairs(build("private"), "USED_IN", label, label), [["react", "package.json"]]);
});

test("a public FILE is labelled by extension and carries no path", () => {
  const files = find(build("public"), "FILE");
  assert.deepEqual(files.map(label).sort(), ["(no extension)", ".env", ".json", ".txt"]);
  for (const file of files) {
    assert.ok(!("path" in file), `public FILE exposed path ${file.path}`);
  }
});

test("a private FILE carries its full path", () => {
  for (const file of find(build("private"), "FILE")) {
    assert.equal(file.path, file.label);
  }
});

test("no path-bearing edge carries a context in either mode", () => {
  for (const mode of ["public", "private"]) {
    for (const edge of build(mode).edges.filter((e) => e.type === "LEAKED_IN" || e.type === "USED_IN")) {
      assert.ok(!("context" in edge), `${mode} ${edge.type} edge kept a context`);
    }
  }
});

test("a FILE takes the worst severity and band of its leaks", () => {
  const files = new Map(find(build("private"), "FILE").map((file) => [file.label, file]));
  assert.equal(files.get("src/config/.env").severity, 90);
  assert.equal(files.get("src/config/.env").band, "CRITICAL");
  assert.equal(files.get("deep\\win\\v1.2\\dist\\config").severity, 40);
  assert.equal(files.get("deep\\win\\v1.2\\dist\\config").band, "LOW");
  assert.equal(files.get("deep\\win\\v1.2\\dist\\config").firstSeen, "2026-09-15T10:00:00Z");
});

test("a CONTAINS edge carries weight 1 and its file's severity", () => {
  const graph = build("private");
  for (const edge of graph.edges.filter((e) => e.type === "CONTAINS")) {
    assert.equal(edge.weight, 1);
    assert.equal(edge.severity, graph.nodes[edge.t].severity);
  }
});
test("an empty context is omitted rather than emitted blank", () => {
  const ownedBy = build("private").edges.find((edge) => edge.type === "OWNED_BY");
  assert.ok(!("context" in ownedBy));
});

test("a public OWNED_BY edge carries no context, even when the row has a non-empty one", () => {
  const ownedByEdges = build("public").edges.filter((edge) => edge.type === "OWNED_BY");
  assert.ok(ownedByEdges.length > 0, "no OWNED_BY edges survived to check");
  for (const edge of ownedByEdges) {
    assert.ok(!("context" in edge), "public OWNED_BY edge exposed a raw context");
  }
});

test("a private OWNED_BY edge keeps its non-empty context", () => {
  const ownedByEdges = build("private").edges.filter((edge) => edge.type === "OWNED_BY");
  assert.ok(ownedByEdges.some((edge) => edge.context === "github:acme/api"),
    "private OWNED_BY lost its context");
});

test("edge endpoints index into the emitted node array", () => {
  for (const mode of ["public", "private"]) {
    const graph = build(mode);
    for (const edge of graph.edges) {
      assert.ok(graph.nodes[edge.s] !== undefined, `${mode} edge source out of range`);
      assert.ok(graph.nodes[edge.t] !== undefined, `${mode} edge target out of range`);
    }
  }
});

test("a repository carries its maintainer count in both modes", () => {
  for (const mode of ["public", "private"]) {
    const graph = build(mode);
    const byLabel = new Map(find(graph, "REPOSITORY").map((n) => [n.label, n.maintainers]));
    const counts = [...byLabel.values()].sort();
    assert.deepEqual(counts, [0, 2], `${mode} maintainer counts wrong`);
  }
});

test("the same fields exist in both modes, so only disclosure differs", () => {
  const fields = (graph, type) => Object.keys(graph.nodes.find((n) => n.type === type)).sort();
  assert.deepEqual(fields(build("public"), "REPOSITORY"), fields(build("private"), "REPOSITORY"));
});

test("stats count nodes and edges by type", () => {
  const stats = build("private").stats;
  assert.equal(stats.nodes.SECRET, 3);
  assert.equal(stats.nodes.MAINTAINER, 2);
  assert.equal(stats.edges.LEAKED_IN, 5);
});

test("stats split credentials into validated live, validated dead and format only", () => {
  const credentials = build("public").stats.credentials;
  const byTarget = new Map(credentials.map((row) => [row.target, row]));
  assert.deepEqual(byTarget.get("openai-api-key"), { target: "openai-api-key", validatedLive: 1, validatedDead: 0, formatOnly: 0 });
  assert.deepEqual(byTarget.get("github-token"), { target: "github-token", validatedLive: 0, validatedDead: 1, formatOnly: 0 });
  assert.deepEqual(byTarget.get("gcp-api-key"), { target: "gcp-api-key", validatedLive: 0, validatedDead: 0, formatOnly: 1 });
});

test("co-occurrence pairs secret types sharing a repository, and names none", () => {
  const pairs = build("public").stats.coOccurrence;
  assert.deepEqual(pairs, [{ a: "github-token", b: "openai-api-key", repositories: 1 }]);
});

const tally = (items, keyOf) => items.reduce((out, item) => {
  out[keyOf(item)] = (out[keyOf(item)] ?? 0) + 1;
  return out;
}, {});

test("public stats count exactly the emitted nodes and edges", () => {
  const graph = build("public");
  assert.deepEqual(graph.stats.nodes, tally(graph.nodes, (node) => node.type));
  assert.deepEqual(graph.stats.edges, tally(graph.edges, (edge) => edge.type));
  assert.deepEqual(graph.stats.bands, tally(graph.nodes, (node) => node.band));
});

test("public stats name no hidden type", () => {
  const { stats } = build("public");
  assert.ok(!("MAINTAINER" in stats.nodes));
  for (const type of ["MAINTAINS", "CO_MAINTAINS", "FOLLOWS"]) {
    assert.ok(!(type in stats.edges), `public stats counted ${type}`);
  }
});

test("private stats still count maintainers and follows", () => {
  const { stats } = build("private");
  assert.equal(stats.nodes.MAINTAINER, 2);
  assert.equal(stats.edges.FOLLOWS, 1);
  assert.equal(stats.nodes.FILE, 4);
  assert.equal(stats.edges.CONTAINS, 4);
});

test("credential and co-occurrence rollups are the same in both modes", () => {
  const publicStats = build("public").stats;
  const privateStats = build("private").stats;
  assert.deepEqual(publicStats.credentials, privateStats.credentials);
  assert.deepEqual(publicStats.coOccurrence, privateStats.coOccurrence);
});

test("lastSeen is the latest sighting among emitted nodes", () => {
  const graph = build("public");
  assert.equal(graph.stats.lastSeen, graph.nodes.map((node) => node.lastSeen).sort().at(-1));
});

test("an empty database reports no lastSeen", () => {
  assert.equal(buildMini("public", "").stats.lastSeen, null);
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

function buildMini(mode, inserts) {
  const db = new SQL.Database();
  db.run(MINI_SCHEMA + inserts);
  try {
    return buildGraph(db, { mode, pseudonym, schemaVersion: 99 });
  } finally {
    db.close();
  }
}

function withUnhandledNodeType(mode) {
  return buildMini(mode, `
    INSERT INTO node (type, target, key, label, severity, severity_band, first_seen, last_seen)
      VALUES ('CONTRIBUTOR', '', 'github:ghost', 'ghost', 10, 'LOW',
        '2026-09-14T10:00:00Z', '2026-09-14T10:00:00Z');`);
}

test("a public build throws on a node type it does not handle", () => {
  assert.throws(() => withUnhandledNodeType("public"), /unhandled node type/);
});

test("a private build still emits a node type it does not handle", () => {
  const graph = withUnhandledNodeType("private");
  assert.deepEqual(find(graph, "CONTRIBUTOR").map((n) => n.label), ["ghost"]);
});

const MULTI_PLATFORM = `
  INSERT INTO node (type, target, key, label, platform, severity, severity_band, first_seen, last_seen) VALUES
    ('REPOSITORY', '', 'github:acme/api', 'acme/api', 'github', 90, 'CRITICAL', '2026-09-14T10:00:00Z', '2026-09-16T10:00:00Z'),
    ('REPOSITORY', '', 'gitlab:acme/web', 'acme/web', 'gitlab', 40, 'LOW', '2026-09-15T10:00:00Z', '2026-09-15T10:00:00Z'),
    ('REPOSITORY', '', 'unknown:acme/old', 'acme/old', NULL, 10, 'LOW', '2026-09-13T10:00:00Z', '2026-09-13T10:00:00Z');`;

test("one platform emits no PLATFORM node and no HOSTED_ON edge", () => {
  for (const mode of ["public", "private"]) {
    const graph = build(mode);
    assert.equal(find(graph, "PLATFORM").length, 0, `${mode} emitted a lone platform`);
    assert.ok(!graph.edges.some((edge) => edge.type === "HOSTED_ON"), `${mode} emitted HOSTED_ON`);
  }
});

test("two platforms emit one PLATFORM each and host every repository on its own", () => {
  const graph = buildMini("private", MULTI_PLATFORM);
  assert.deepEqual(find(graph, "PLATFORM").map(label), ["github", "gitlab"]);
  assert.deepEqual(pairs(graph, "HOSTED_ON", label, label),
    [["acme/api", "github"], ["acme/web", "gitlab"]]);
});

test("a repository with no platform is neither hosted nor counted as a platform", () => {
  const graph = buildMini("private", MULTI_PLATFORM);
  assert.equal(find(graph, "PLATFORM").length, 2);
  assert.ok(!pairs(graph, "HOSTED_ON", label, label).some(([repository]) => repository === "acme/old"));
});

test("a PLATFORM spans its repositories' sightings at zero severity", () => {
  const github = find(buildMini("private", MULTI_PLATFORM), "PLATFORM").find((node) => node.label === "github");
  assert.deepEqual(
    { severity: github.severity, band: github.band, firstSeen: github.firstSeen, lastSeen: github.lastSeen },
    { severity: 0, band: "LOW", firstSeen: "2026-09-14T10:00:00Z", lastSeen: "2026-09-16T10:00:00Z" });
});

test("public keeps PLATFORM and HOSTED_ON, a platform naming nobody", () => {
  const graph = buildMini("public", MULTI_PLATFORM);
  assert.equal(find(graph, "PLATFORM").length, 2);
  assert.equal(graph.edges.filter((edge) => edge.type === "HOSTED_ON").length, 2);
});
