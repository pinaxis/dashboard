import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPrivateOnlyData } from "../scripts/assert-private-only-data.mjs";

function build({ document = { mode: "private" }, extra, graph = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "private-data-"));
  mkdirSync(join(root, "api"), { recursive: true });
  if (graph) {
    writeFileSync(join(root, "api", "graph.json"), JSON.stringify(document), "utf8");
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

test("accepts exactly one private-mode api/graph.json", () => {
  assert.equal(check(), 1);
});

test("rejects any extra file, which the worker would have no reason to hold", () => {
  assert.throws(() => check({ extra: "index.html" }), /exactly api\/graph\.json/);
});

test("rejects a build with no graph at all", () => {
  assert.throws(() => check({ graph: false }), /exactly api\/graph\.json/);
});

test("rejects a public-mode document in the private slot", () => {
  assert.throws(() => check({ document: { mode: "public" } }), /not a private-mode document/);
});
