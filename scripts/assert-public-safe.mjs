import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_MARKERS = ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "sk_live_", "pk_live_",
  "sk-", "AIza", "BEGIN PRIVATE KEY", "BEGIN RSA PRIVATE KEY", "iam.gserviceaccount.com"];
const NODE_KEYS = ["type", "kind", "label", "count"];
const CLOCK = /\d{4}-\d\d-\d\dT/;
const MIN_GROUP = 5;

function assertCount(value, where) {
  assert.ok(value === 0 || value >= MIN_GROUP, `${where} is below the suppression floor: ${value}`);
}

export function assertPublicSafe(document) {
  assert.equal(document.mode, "public", "a public build must be served a document built in public mode");

  for (const node of document.nodes) {
    assert.equal(node.type, "CATEGORY", `a public graph holds only category nodes, found ${node.type}`);
    assert.deepEqual(Object.keys(node).sort(), [...NODE_KEYS].sort(),
      `a public category node carries only ${NODE_KEYS.join(", ")}`);
    assertCount(node.count, `category node ${node.label}`);
  }
  for (const edge of document.edges) {
    assert.deepEqual(Object.keys(edge).sort(), ["s", "t", "weight"], "a public edge carries only s, t, weight");
    assertCount(edge.weight, "category edge");
  }

  const stats = document.stats ?? {};
  for (const field of ["byCredential", "byExtension", "byBand"]) {
    for (const entry of stats[field] ?? []) {
      assertCount(entry.count, `${field} ${entry.label}`);
    }
  }
  for (const [part, value] of Object.entries(stats.validity ?? {})) {
    assertCount(value, `validity ${part}`);
  }
  for (const entry of stats.monthly ?? []) {
    assertCount(entry.found, `month ${entry.month}`);
  }
  assertCount(stats.repositories ?? 0, "repositories");
  assertCount(stats.owners ?? 0, "owners");

  const whole = JSON.stringify(document);
  assert.equal(whole.match(CLOCK), null, "a public graph must carry no clock timestamp, only YYYY-MM-DD");
  for (const marker of SECRET_MARKERS) {
    assert.ok(!whole.includes(marker), `a public graph must not contain ${marker}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  assertPublicSafe(JSON.parse(readFileSync(join(root, "public", "graph.json"), "utf8")));
  console.log("public graph is safe to publish");
}
