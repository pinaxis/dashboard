import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPublicSafe } from "../scripts/assert-public-safe.mjs";

function clean() {
  return {
    mode: "public",
    schema: 4,
    dataset: "dataset-v4",
    generatedAt: "2026-09-19T10:00:00Z",
    nodes: [
      { type: "SECRET", target: "github-token", category: "credentials", valid: false,
        validated: true, severity: 60, band: "MEDIUM", firstSeen: "x", lastSeen: "y" },
      { type: "REPOSITORY", label: "repo-0123abcd", maintainers: 2, severity: 90, band: "CRITICAL",
        firstSeen: "x", lastSeen: "y" },
      { type: "OWNER", label: "owner-89abcdef", severity: 90, band: "CRITICAL",
        firstSeen: "x", lastSeen: "y" },
      { type: "PACKAGE", target: "npm-package", label: "react", popularity: 5000, severity: 10,
        band: "LOW", firstSeen: "x", lastSeen: "y" },
      { type: "FILE", label: ".env", severity: 60, band: "MEDIUM", firstSeen: "x", lastSeen: "y" },
    ],
    edges: [{ s: 0, t: 1, type: "LEAKED_IN", weight: 1, severity: 60, context: ".env" }],
    stats: { nodes: {}, edges: {}, bands: {}, credentials: [], coOccurrence: [], lastSeen: "y" },
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

test("rejects a maintainer node", () => {
  const poisoned = clean();
  poisoned.nodes.push({ type: "MAINTAINER", label: "jdoe", severity: 1, band: "LOW",
    firstSeen: "x", lastSeen: "y" });
  assert.throws(() => assertPublicSafe(poisoned), /MAINTAINER/);
});

test("rejects a maintains edge", () => {
  const poisoned = clean();
  poisoned.edges.push({ s: 0, t: 1, type: "MAINTAINS", weight: 1, severity: 1 });
  assert.throws(() => assertPublicSafe(poisoned), /MAINTAINS/);
});

test("rejects a co-maintains edge", () => {
  const poisoned = clean();
  poisoned.edges.push({ s: 0, t: 1, type: "CO_MAINTAINS", weight: 1, severity: 1 });
  assert.throws(() => assertPublicSafe(poisoned), /CO_MAINTAINS/);
});

test("rejects a real repository name", () => {
  const poisoned = clean();
  poisoned.nodes[1].label = "acme/api";
  assert.throws(() => assertPublicSafe(poisoned), /pseudonym/);
});

test("rejects a real owner name", () => {
  const poisoned = clean();
  poisoned.nodes[2].label = "acme";
  assert.throws(() => assertPublicSafe(poisoned), /pseudonym/);
});

test("rejects a secret that carries a value", () => {
  const poisoned = clean();
  poisoned.nodes[0].value = "••••";
  assert.throws(() => assertPublicSafe(poisoned), /SECRET/);
});

test("rejects a secret that carries a key or label", () => {
  for (const field of ["key", "label"]) {
    const poisoned = clean();
    poisoned.nodes[0][field] = "anything";
    assert.throws(() => assertPublicSafe(poisoned), /SECRET/, `${field} was allowed through`);
  }
});

test("rejects an edge context that is still a path", () => {
  for (const context of ["src/config/.env", "deep\\win\\notes.txt"]) {
    const poisoned = clean();
    poisoned.edges[0].context = context;
    assert.throws(() => assertPublicSafe(poisoned), /path/, `${context} was allowed through`);
  }
});

test("rejects a document containing a secret marker anywhere", () => {
  const poisoned = clean();
  poisoned.stats.coOccurrence.push({ a: "ghp_realtokenlooking", b: "x", repositories: 1 });
  assert.throws(() => assertPublicSafe(poisoned), /ghp_/);
});

test("allows a package name that collides with a narrowed marker", () => {
  const fine = clean();
  fine.nodes[3].label = "Flask-Login";
  assert.doesNotThrow(() => assertPublicSafe(fine));
});

test("rejects either kind of stripe live key", () => {
  for (const marker of ["sk_live_", "pk_live_"]) {
    const poisoned = clean();
    poisoned.stats.coOccurrence.push({ a: `${marker}realkeylooking`, b: "x", repositories: 1 });
    assert.throws(() => assertPublicSafe(poisoned), new RegExp(marker), `${marker} was allowed through`);
  }
});

test("rejects a follows edge", () => {
  const poisoned = clean();
  poisoned.edges.push({ s: 2, t: 2, type: "FOLLOWS", weight: 1, severity: 1 });
  assert.throws(() => assertPublicSafe(poisoned), /FOLLOWS/);
});

test("accepts stats that count only drawn types, and a zero count for an undrawn one", () => {
  const document = clean();
  document.stats.nodes = { SECRET: 1, REPOSITORY: 1, OWNER: 1, PACKAGE: 1, FILE: 1, PLATFORM: 0 };
  document.stats.edges = { LEAKED_IN: 1 };
  assert.doesNotThrow(() => assertPublicSafe(document));
});

test("rejects a FILE label that is a path", () => {
  const poisoned = clean();
  poisoned.nodes[4].label = "src/config/.env";
  assert.throws(() => assertPublicSafe(poisoned), /FILE label must be an extension/);
});

test("rejects a FILE label that is a bare file name", () => {
  const poisoned = clean();
  poisoned.nodes[4].label = "notes.txt";
  assert.throws(() => assertPublicSafe(poisoned), /FILE label must be an extension/);
});

test("rejects a FILE that carries its path", () => {
  const poisoned = clean();
  poisoned.nodes[4].path = "src/config/.env";
  assert.throws(() => assertPublicSafe(poisoned), /FILE node must not carry path/);
});

test("rejects stats that count maintainers", () => {
  const poisoned = clean();
  poisoned.stats.nodes.MAINTAINER = 2192;
  assert.throws(() => assertPublicSafe(poisoned), /must not count MAINTAINER/);
});

for (const type of ["MAINTAINS", "CO_MAINTAINS", "FOLLOWS"]) {
  test(`rejects stats that count ${type} edges`, () => {
    const poisoned = clean();
    poisoned.stats.edges[type] = 1;
    assert.throws(() => assertPublicSafe(poisoned), new RegExp(`must not count ${type}`));
  });
}

test("rejects stats that count a node type the graph does not draw", () => {
  const poisoned = clean();
  poisoned.stats.nodes.PLATFORM = 2;
  assert.throws(() => assertPublicSafe(poisoned), /does not draw/);
});

test("accepts a platform named by a short slug", () => {
  const document = clean();
  document.nodes.push({ type: "PLATFORM", label: "github", severity: 0, band: "LOW", firstSeen: "x", lastSeen: "y" });
  assert.doesNotThrow(() => assertPublicSafe(document));
});

test("rejects a platform label that names a host", () => {
  const poisoned = clean();
  poisoned.nodes.push({ type: "PLATFORM", label: "gitlab.acme.internal", severity: 0, band: "LOW",
    firstSeen: "x", lastSeen: "y" });
  assert.throws(() => assertPublicSafe(poisoned), /PLATFORM label must be a short slug/);
});

test("rejects a document without stats", () => {
  const poisoned = clean();
  delete poisoned.stats;
  assert.throws(() => assertPublicSafe(poisoned), /must carry stats/);
});

test("rejects crawl telemetry in a public document", () => {
  const poisoned = clean();
  poisoned.crawl = { dataset: "dataset-v5", since: "x", targets: [], sources: [], runs: [] };
  assert.throws(() => assertPublicSafe(poisoned), /crawl telemetry/);
});
