import { test } from "node:test";
import assert from "node:assert/strict";
import { probeSession, PRIVATE_GRAPH_URL } from "../src/data/session.ts";

const answer = (fields) => async () => ({ type: "basic", ok: true, status: 200, json: async () => ({}), ...fields });

test("a private document from /api/graph means signed in", async () => {
  const document = { mode: "private", nodes: [], edges: [] };
  assert.deepEqual(await probeSession(answer({ json: async () => document })), document);
});

test("asks /api/graph without following redirects or using a cache", async () => {
  const seen = [];
  await probeSession(async (input, init) => { seen.push([input, init]); return { type: "opaqueredirect", ok: false, status: 0 }; });
  assert.deepEqual(seen, [[PRIVATE_GRAPH_URL, { redirect: "manual", credentials: "same-origin", cache: "no-store" }]]);
});

test("the Access login redirect, a 403 and a network failure all mean signed out", async () => {
  assert.equal(await probeSession(answer({ type: "opaqueredirect", ok: false, status: 0 })), null);
  assert.equal(await probeSession(answer({ ok: false, status: 403 })), null);
  assert.equal(await probeSession(async () => { throw new TypeError("network"); }), null);
});

test("a public-mode document is never taken for a private session", async () => {
  assert.equal(await probeSession(answer({ json: async () => ({ mode: "public", nodes: [] }) })), null);
});

test("a body that is not JSON means signed out", async () => {
  assert.equal(await probeSession(answer({ json: async () => { throw new SyntaxError("html"); } })), null);
});
