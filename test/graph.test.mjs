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

test("public reduces an edge context to an extension", () => {
  const contexts = build("public").edges.filter((e) => e.context !== undefined).map((e) => e.context);
  assert.ok(contexts.length > 0, "no contexts survived to check");
  for (const context of contexts) {
    assert.ok(!context.includes("/") && !context.includes("\\"), `public context leaked a path: ${context}`);
  }
  assert.ok(contexts.includes(".env"));
  assert.ok(contexts.includes(".txt"));
  assert.ok(contexts.includes("(no extension)"));
});

test("private keeps the full path", () => {
  const contexts = build("private").edges.filter((e) => e.context !== undefined).map((e) => e.context);
  assert.ok(contexts.includes("src/config/.env"));
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

test("an edge resolves to the specific nodes it connects, not merely to some node", () => {
  const graph = build("private");
  const leaked = graph.edges
    .filter((edge) => edge.type === "LEAKED_IN")
    .map((edge) => [graph.nodes[edge.s].target, graph.nodes[edge.t].label])
    .sort();
  assert.deepEqual(leaked, [
    ["gcp-api-key", "acme/web"],
    ["github-token", "acme/api"],
    ["openai-api-key", "acme/api"],
  ]);
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
  assert.equal(stats.edges.LEAKED_IN, 3);
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

test("stats are identical in both modes, being aggregates", () => {
  assert.deepEqual(build("public").stats, build("private").stats);
});

function withUnhandledNodeType(mode) {
  const db = new SQL.Database();
  db.run(`
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
      severity REAL NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);
    INSERT INTO node (type, target, key, label, severity, severity_band, first_seen, last_seen)
      VALUES ('CONTRIBUTOR', '', 'github:ghost', 'ghost', 10, 'LOW',
        '2026-09-14T10:00:00Z', '2026-09-14T10:00:00Z');
  `);
  try {
    return buildGraph(db, { mode, pseudonym, schemaVersion: 99 });
  } finally {
    db.close();
  }
}

test("a public build throws on a node type it does not handle", () => {
  assert.throws(() => withUnhandledNodeType("public"), /unhandled node type/);
});

test("a private build still emits a node type it does not handle", () => {
  const graph = withUnhandledNodeType("private");
  assert.deepEqual(find(graph, "CONTRIBUTOR").map((n) => n.label), ["ghost"]);
});
