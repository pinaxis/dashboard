import { test } from "node:test";
import assert from "node:assert/strict";
import { keyTypeView } from "../src/data/keyType.ts";

const info = { name: "github-token", category: "credentials", kind: "VALUE", secret: true,
  verification: "VALIDATED", weight: 8, rateLimitPerMinute: 60,
  validationEndpoint: "https://api.github.com/user", prefixRules: [{ prefix: "ghp_", regex: "ghp_x", length: 40 }] };
const catalog = new Map([["github-token", info]]);
const doc = { stats: { credentials: [{ target: "github-token", validatedLive: 1, validatedDead: 2, formatOnly: 3 }] } };

test("a known type carries its info and a summed tally", () => {
  const view = keyTypeView("github-token", catalog, doc);
  assert.equal(view.known, true);
  assert.equal(view.info.validationEndpoint, "https://api.github.com/user");
  assert.deepEqual(view.tally, { live: 1, dead: 2, formatOnly: 3, total: 6 });
});

test("an unknown type is marked not known, with a zero tally and null info", () => {
  const view = keyTypeView("retired-type", catalog, doc);
  assert.equal(view.known, false);
  assert.equal(view.info, null);
  assert.deepEqual(view.tally, { live: 0, dead: 0, formatOnly: 0, total: 0 });
});

import { targetFindings } from "../src/data/keyType.ts";

const fdoc = {
  nodes: [
    { type: "SECRET", target: "X", band: "HIGH" },
    { type: "SECRET", target: "X", band: "LOW" },
    { type: "SECRET", target: "Y", band: "HIGH" },
    { type: "FILE" },
    { type: "FILE" },
    { type: "REPOSITORY", label: "owner/r1" },
    { type: "OWNER", label: "owner" },
  ],
  edges: [
    { s: 0, t: 3, type: "LEAKED_IN" },
    { s: 1, t: 4, type: "LEAKED_IN" },
    { s: 2, t: 3, type: "LEAKED_IN" },
    { s: 5, t: 3, type: "CONTAINS" },
    { s: 5, t: 4, type: "CONTAINS" },
    { s: 5, t: 6, type: "OWNED_BY" },
  ],
};

test("targetFindings traces a type to its affected repositories, owners, and severity spread", () => {
  const f = targetFindings(fdoc, "X");
  assert.deepEqual(f.repos, [{ label: "owner/r1", count: 2 }]);
  assert.deepEqual(f.owners, ["owner"]);
  assert.deepEqual(f.bands, { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 1 });
});

test("targetFindings is empty for a type with no secrets", () => {
  const f = targetFindings(fdoc, "Z");
  assert.deepEqual(f.repos, []);
  assert.deepEqual(f.owners, []);
  assert.deepEqual(f.bands, { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 });
});
