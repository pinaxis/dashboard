import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPriorities, savePriorities, priorityRows, PRIORITIES_URL } from "../src/data/priorities.ts";

const cat = [
  { name: "github-token", weight: 8 },
  { name: "openai-api-key", weight: 4 },
  { name: "npm-package", weight: 1 },
];

test("loadPriorities returns the weights map, or {} on failure", async () => {
  const seen = [];
  const got = await loadPriorities(async (url) => { seen.push(url); return { ok: true, json: async () => ({ weights: { "npm-package": 5 } }) }; });
  assert.deepEqual(seen, [PRIORITIES_URL]);
  assert.deepEqual(got, { "npm-package": 5 });
  assert.deepEqual(await loadPriorities(async () => { throw new Error("net"); }), {});
  assert.deepEqual(await loadPriorities(async () => ({ ok: false, status: 502, json: async () => ({}) })), {});
});

test("savePriorities PUTs the weights and throws the worker error on non-ok", async () => {
  let sent = null;
  await savePriorities({ "github-token": 9 }, async (url, init) => { sent = { url, init }; return { ok: true, json: async () => ({ saved: true }) }; });
  assert.equal(sent.url, PRIORITIES_URL);
  assert.equal(sent.init.method, "PUT");
  assert.deepEqual(JSON.parse(sent.init.body), { weights: { "github-token": 9 } });
  await assert.rejects(
    () => savePriorities({ "github-token": 9 }, async () => ({ ok: false, json: async () => ({ error: "nope" }) })),
    /nope/);
});

test("priorityRows merges overrides over catalog defaults, sorted by weight then name", () => {
  const rows = priorityRows(cat, { "npm-package": 20 });
  assert.deepEqual(rows[0], { name: "npm-package", weight: 20, overridden: true });
  assert.deepEqual(rows[1], { name: "github-token", weight: 8, overridden: false });
  assert.deepEqual(rows[2], { name: "openai-api-key", weight: 4, overridden: false });
});
