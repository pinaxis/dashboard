import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPrivateOnlyData } from "../scripts/assert-private-only-data.mjs";

function build({ document = { mode: "private" }, extra, graph = true, catalog = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "private-data-"));
  mkdirSync(join(root, "api"), { recursive: true });
  if (graph) {
    writeFileSync(join(root, "api", "graph.json"), JSON.stringify(document), "utf8");
  }
  if (catalog) {
    writeFileSync(join(root, "api", "catalog.json"), "[]", "utf8");
  }
  if (extra) {
    writeFileSync(join(root, extra), "x", "utf8");
  }
  return root;
}

function check(options) {
  const root = build(options);
  try {
    return assertPrivateOnlyData(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts exactly the private graph and catalog", () => {
  assert.equal(check(), 2);
});

test("rejects any extra file, which the worker would have no reason to hold", () => {
  assert.throws(() => check({ extra: "index.html" }), /exactly/);
});

test("rejects a build with no graph at all", () => {
  assert.throws(() => check({ graph: false }), /exactly/);
});

test("rejects a build with no catalog at all", () => {
  assert.throws(() => check({ catalog: false }), /exactly/);
});

test("rejects a public-mode document in the private slot", () => {
  assert.throws(() => check({ document: { mode: "public" } }), /not a private-mode document/);
});
