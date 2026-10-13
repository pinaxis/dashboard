import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog, catalogByName, CATALOG_URL } from "../src/data/catalog.ts";

const entry = { name: "github-token", category: "credentials", kind: "VALUE", secret: true,
  verification: "VALIDATED", weight: 8, rateLimitPerMinute: 60,
  validationEndpoint: "https://api.github.com/user", prefixRules: [{ prefix: "ghp_", regex: "ghp_x", length: 40 }] };

const ok = (body) => async () => ({ ok: true, json: async () => body });

test("loadCatalog reads /api/catalog once and returns the array", async () => {
  const seen = [];
  const entries = await loadCatalog(async (url) => { seen.push(url); return { ok: true, json: async () => [entry] }; });
  assert.deepEqual(seen, [CATALOG_URL]);
  assert.equal(entries[0].name, "github-token");
});

test("loadCatalog returns [] on failure, non-ok, non-json, or a non-array body", async () => {
  assert.deepEqual(await loadCatalog(async () => { throw new Error("net"); }), []);
  assert.deepEqual(await loadCatalog(async () => ({ ok: false, status: 503, json: async () => ({}) })), []);
  assert.deepEqual(await loadCatalog(async () => ({ ok: true, json: async () => { throw new Error("html"); } })), []);
  assert.deepEqual(await loadCatalog(ok({ not: "an array" })), []);
});

test("catalogByName indexes by target name", () => {
  assert.equal(catalogByName([entry]).get("github-token").weight, 8);
});
