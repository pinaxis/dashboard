import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPrivateScoped } from "../scripts/assert-private-scoped.mjs";

const INDEX = '<html><script src="/private/assets/app.js"></script>'
  + '<link href="/private/assets/app.css"><link href="https://fonts.googleapis.com/x"></html>';

function build({ index = INDEX, stray } = {}) {
  const root = mkdtempSync(join(tmpdir(), "scoped-"));
  mkdirSync(join(root, "private", "assets"), { recursive: true });
  writeFileSync(join(root, "private", "index.html"), index, "utf8");
  writeFileSync(join(root, "private", "assets", "app.js"), "//", "utf8");
  writeFileSync(join(root, "private", "graph.json"), "{}", "utf8");
  if (stray) {
    writeFileSync(join(root, stray), "leaked", "utf8");
  }
  return root;
}

function check(options) {
  const root = build(options);
  try {
    return assertPrivateScoped(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts a build whose every file sits under the protected path", () => {
  assert.equal(check(), 3);
});

test("rejects a file served from outside the protected path", () => {
  assert.throws(() => check({ stray: "graph.json" }), /served outside the Access-protected/);
});

/** The base is what rewrites these, and losing it is the realistic regression. */
test("rejects an index that points at the unprotected origin root", () => {
  const index = '<html><script src="/assets/app.js"></script></html>';
  assert.throws(() => check({ index }), /points outside \/private/);
});

test("allows absolute external references, which no gate could cover anyway", () => {
  const index = '<html><link href="https://fonts.googleapis.com/x">'
    + '<script src="/private/assets/app.js"></script></html>';
  assert.equal(check({ index }), 3);
});

test("refuses to pass an empty build rather than reporting nothing to check", () => {
  const root = mkdtempSync(join(tmpdir(), "scoped-empty-"));
  try {
    assert.throws(() => assertPrivateScoped(root), /produced no files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
