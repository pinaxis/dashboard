import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSalt, createPseudonymizer } from "../scripts/lib/anonymize.mjs";

function tempRoot(saltText) {
  const dir = mkdtempSync(join(tmpdir(), "anon-"));
  if (saltText !== undefined) {
    writeFileSync(join(dir, ".anon-salt"), saltText, "utf8");
  }
  return dir;
}

test("prefers the environment over the file", () => {
  const root = tempRoot("from-file");
  try {
    assert.equal(loadSalt({ env: { PINAXIS_ANON_SALT: "from-env" }, root }), "from-env");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("falls back to the salt file and trims it", () => {
  const root = tempRoot("from-file\n");
  try {
    assert.equal(loadSalt({ env: {}, root }), "from-file");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("throws when neither source has a salt, rather than defaulting", () => {
  const root = tempRoot();
  try {
    assert.throws(() => loadSalt({ env: {}, root }), /PINAXIS_ANON_SALT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("treats a blank environment value as absent", () => {
  const root = tempRoot();
  try {
    assert.throws(() => loadSalt({ env: { PINAXIS_ANON_SALT: "   " }, root }), /PINAXIS_ANON_SALT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("propagates a non-ENOENT read error instead of reporting the salt as absent", () => {
  const root = mkdtempSync(join(tmpdir(), "anon-"));
  try {
    mkdirSync(join(root, ".anon-salt"));
    assert.throws(
      () => loadSalt({ env: {}, root }),
      (error) => error.code !== undefined && !/no anonymization salt/.test(error.message)
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("produces a prefixed eight hex character pseudonym", () => {
  const pseudonym = createPseudonymizer("salt", 4);
  assert.match(pseudonym("repo", "github:acme/api"), /^repo-[0-9a-f]{8}$/);
});

test("is stable for the same salt and key", () => {
  const first = createPseudonymizer("salt", 4);
  const second = createPseudonymizer("salt", 4);
  assert.equal(first("repo", "github:acme/api"), second("repo", "github:acme/api"));
});

test("differs for a different salt", () => {
  const first = createPseudonymizer("salt-one", 4);
  const second = createPseudonymizer("salt-two", 4);
  assert.notEqual(first("repo", "github:acme/api"), second("repo", "github:acme/api"));
});

test("differs for a different schema version, so a dataset reset re-draws", () => {
  const fourth = createPseudonymizer("salt", 4);
  const fifth = createPseudonymizer("salt", 5);
  assert.notEqual(fourth("repo", "github:acme/api"), fifth("repo", "github:acme/api"));
});

test("does not depend on what else is in the graph", () => {
  const pseudonym = createPseudonymizer("salt", 4);
  const before = pseudonym("repo", "github:acme/web");
  pseudonym("repo", "github:inserted/later");
  assert.equal(pseudonym("repo", "github:acme/web"), before);
});
