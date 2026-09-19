import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionOf } from "../scripts/lib/paths.mjs";

test("reduces an ordinary path to its extension", () => {
  assert.equal(extensionOf("src/config/app.js"), ".js");
});

test("admits an allowlisted dotfile whole", () => {
  assert.equal(extensionOf("src/config/.env"), ".env");
});

test("collapses a dotfile that is not allowlisted", () => {
  assert.equal(extensionOf(".aws-credentials-jdoe"), "(other)");
});

test("reads the basename of a backslash path, not a directory", () => {
  assert.equal(extensionOf("deep\\win\\notes.txt"), ".txt");
});

test("ignores a dot that sits only in a directory name", () => {
  assert.equal(extensionOf("deep\\win\\v1.2\\dist\\config"), "(no extension)");
});

test("collapses a datestamped suffix", () => {
  assert.equal(extensionOf("backup.20251108_222836"), "(other)");
});

test("never returns a path separator", () => {
  for (const path of ["src/config/.env", "deep\\win\\notes.txt", "a/b/c"]) {
    const reduced = extensionOf(path);
    assert.ok(!reduced.includes("/") && !reduced.includes("\\"), `leaked a separator: ${reduced}`);
  }
});
