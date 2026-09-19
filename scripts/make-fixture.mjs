import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const D1 = "2026-09-14T10:00:00Z";
const D2 = "2026-09-15T10:00:00Z";
const D3 = "2026-09-16T10:00:00Z";

// type, target, key, label, category, valid, platform, props, popularity, severity, band, seen
const NODES = [
  ["SECRET", "github-token", "ghp_aaaaaaaaaaaabbbb", null, "credentials", 0, "github",
    '{"validated":true,"weight":2}', null, 60, "MEDIUM", D1],
  ["SECRET", "openai-api-key", "sk-aaaaaaaaaaaabbbb", null, "credentials", 1, "github",
    '{"validated":true,"weight":1}', null, 90, "CRITICAL", D1],
  ["SECRET", "gcp-api-key", "AIzaaaaaaaaaaaabbbb", null, "credentials", 1, "github",
    '{"validated":false,"weight":1}', null, 40, "LOW", D2],
  ["REPOSITORY", "", "github:acme/api", "acme/api", null, null, "github", "{}", null, 90, "CRITICAL", D1],
  ["REPOSITORY", "", "github:acme/web", "acme/web", null, null, "github", "{}", null, 40, "LOW", D2],
  ["OWNER", "", "github:acme", "acme", null, null, "github", "{}", null, 90, "CRITICAL", D1],
  ["PACKAGE", "npm-package", "react", "react", "dependencies", null, "github", "{}", 5000, 10, "LOW", D1],
  ["MAINTAINER", "", "github:jdoe", "jdoe", null, null, "github", "{}", null, 90, "CRITICAL", D2],
  ["MAINTAINER", "", "github:asmith", "asmith", null, null, "github", "{}", null, 90, "CRITICAL", D2],
];

/**
 * @remarks the LEAKED_IN contexts carry the path shapes the reduction must never publish: a directory
 * component, a backslash path, and a backslash path whose only dot sits in a DIRECTORY name.
 */
const EDGES = [
  [1, 4, "LEAKED_IN", "src/config/.env", 1, 60],
  [2, 4, "LEAKED_IN", "deep\\win\\notes.txt", 1, 90],
  [3, 5, "LEAKED_IN", "deep\\win\\v1.2\\dist\\config", 1, 40],
  [4, 6, "OWNED_BY", "", 1, 90],
  [5, 6, "OWNED_BY", "", 1, 40],
  [4, 6, "OWNED_BY", "github:acme/api", 1, 90],
  [7, 5, "USED_IN", "package.json", 1, 0],
  [8, 4, "MAINTAINS", "", 120, 90],
  [9, 4, "MAINTAINS", "", 30, 90],
  [8, 9, "CO_MAINTAINS", "github:acme/api", 1, 90],
];

const VARIANTS = [[7, "18.2.0", 5], [7, "17.0.2", 2]];

const initSqlJs = require("sql.js");
const SQL = await initSqlJs();
const db = new SQL.Database();
db.run(`
  CREATE TABLE node (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', key TEXT NOT NULL,
    label TEXT, category TEXT, valid INTEGER, platform TEXT, props TEXT,
    popularity INTEGER, last_counted TEXT, last_enriched TEXT,
    severity REAL NOT NULL DEFAULT 0, severity_band TEXT NOT NULL DEFAULT 'LOW',
    first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
    UNIQUE(type, target, key));
  CREATE TABLE edge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    src INTEGER NOT NULL, dst INTEGER NOT NULL, type TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '', weight INTEGER NOT NULL DEFAULT 1,
    severity REAL NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
    UNIQUE(src, dst, type, context));
  CREATE TABLE node_variant (
    node_id INTEGER NOT NULL, variant TEXT NOT NULL,
    sightings INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
    PRIMARY KEY (node_id, variant));
  CREATE TABLE pending (source TEXT NOT NULL, target TEXT NOT NULL, query TEXT NOT NULL,
    PRIMARY KEY (source, target, query));
  PRAGMA user_version = 4;
`);
for (const [type, target, key, label, category, valid, platform, props, popularity, severity, band, seen]
  of NODES) {
  db.run(`INSERT INTO node
      (type,target,key,label,category,valid,platform,props,popularity,severity,severity_band,
       first_seen,last_seen)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [type, target, key, label, category, valid, platform, props, popularity, severity, band, seen, D3]);
}
for (const [src, dst, type, context, weight, severity] of EDGES) {
  db.run("INSERT INTO edge (src,dst,type,context,weight,severity,first_seen,last_seen) VALUES (?,?,?,?,?,?,?,?)",
    [src, dst, type, context, weight, severity, D1, D3]);
}
for (const [nodeId, variant, sightings] of VARIANTS) {
  db.run("INSERT INTO node_variant VALUES (?,?,?,?,?)", [nodeId, variant, sightings, D1, D3]);
}
for (let index = 0; index < 5; index += 1) {
  db.run("INSERT INTO pending VALUES ('github','github-token',?)", [`q${index}`]);
}

mkdirSync(join(root, "scratch"), { recursive: true });
writeFileSync(join(root, "scratch", "fixture.db"), Buffer.from(db.export()));
db.close();
console.log("wrote scratch/fixture.db (schema v4, 9 nodes, 10 edges)");
