import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPublicSafe } from "../scripts/assert-public-safe.mjs";

function clean() {
  return {
    mode: "public",
    schema: 5,
    dataset: "dataset-v5",
    generatedAt: "2026-10-12",
    nodes: [
      { type: "CATEGORY", kind: "credential", label: "openai-api-key", count: 6 },
      { type: "CATEGORY", kind: "extension", label: ".env", count: 10 },
      { type: "CATEGORY", kind: "band", label: "CRITICAL", count: 6 },
      { type: "CATEGORY", kind: "repositories", label: "repositories", count: 9 },
    ],
    edges: [{ s: 0, t: 1, weight: 6 }],
    stats: {
      byCredential: [{ label: "openai-api-key", count: 6 }],
      byExtension: [{ label: ".env", count: 10 }],
      byBand: [{ label: "CRITICAL", count: 6 }],
      validity: { live: 6, dead: 0, formatOnly: 0 },
      monthly: [{ month: "2026-06", found: 10 }],
      total: 6,
      repositories: 9,
      asOf: "2026-08-02",
    },
  };
}

test("accepts a clean public document", () => {
  assert.doesNotThrow(() => assertPublicSafe(clean()));
});

test("rejects a private document served as public", () => {
  const poisoned = clean();
  poisoned.mode = "private";
  assert.throws(() => assertPublicSafe(poisoned), /public/);
});

for (const kind of ["SECRET", "REPOSITORY", "OWNER", "FILE", "MAINTAINER", "PACKAGE", "PLATFORM"]) {
  test(`rejects a ${kind} node in a public graph`, () => {
    const poisoned = clean();
    poisoned.nodes.push({ type: kind, label: "x", count: 1 });
    assert.throws(() => assertPublicSafe(poisoned), /only category nodes/);
  });
}

test("rejects a node field beyond the category shape", () => {
  const poisoned = clean();
  poisoned.nodes[0].firstSeen = "2026-06-10";
  assert.throws(() => assertPublicSafe(poisoned), /category node/);
});

test("rejects a clock timestamp anywhere", () => {
  const poisoned = clean();
  poisoned.stats.asOf = "2026-08-02T00:00:00Z";
  assert.throws(() => assertPublicSafe(poisoned), /clock timestamp/);
});

test("rejects a published count below the floor", () => {
  const poisoned = clean();
  poisoned.stats.byCredential.push({ label: "aws", count: 3 });
  assert.throws(() => assertPublicSafe(poisoned), /below the suppression floor/);
});

test("rejects a category edge below the floor", () => {
  const poisoned = clean();
  poisoned.edges.push({ s: 0, t: 2, weight: 2 });
  assert.throws(() => assertPublicSafe(poisoned), /below the suppression floor/);
});

test("still rejects a secret marker anywhere", () => {
  const poisoned = clean();
  poisoned.nodes[0].label = "ghp_aaaaaaaaaaaabbbb";
  assert.throws(() => assertPublicSafe(poisoned), /ghp_/);
});
