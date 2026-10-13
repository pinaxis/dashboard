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
