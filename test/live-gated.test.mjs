import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLiveGated } from "../scripts/assert-live-gated.mjs";

const ORIGIN = "https://pinaxis.intisy.dev";
const ACCESS = "https://intisy.cloudflareaccess.com/cdn-cgi/access/login/pinaxis.intisy.dev?kid=x";

function site(overrides = {}) {
  const answers = {
    "/login": { status: 302, location: ACCESS },
    "/api/graph": { status: 302, location: ACCESS },
    "/api/crawl": { status: 403 },
    "/private/graph.json": { status: 302, location: `${ORIGIN}/login` },
    "/graph.json": { status: 200, body: { mode: "public", nodes: [] } },
    ...overrides,
  };
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push([new URL(url).pathname, init.redirect]);
    const answer = answers[new URL(url).pathname];
    return { status: answer.status, headers: { get: (name) => (name === "location" ? answer.location ?? null : null) },
      json: async () => answer.body };
  };
  return { fetcher, seen };
}

test("a correctly gated site has no failures, and nothing follows a redirect", async () => {
  const { fetcher, seen } = site();
  assert.deepEqual(await checkLiveGated(ORIGIN, fetcher), []);
  assert.ok(seen.every(([, redirect]) => redirect === "manual"));
  assert.equal(seen.length, 5);
});

test("a 200 on any gated path is a failure naming the path", async () => {
  for (const path of ["/login", "/api/graph", "/api/crawl", "/private/graph.json"]) {
    const failures = await checkLiveGated(ORIGIN, site({ [path]: { status: 200 } }).fetcher);
    assert.equal(failures.length, 1, path);
    assert.match(failures[0], new RegExp(path.replace(/\//g, "\\/")));
  }
});

test("a redirect somewhere other than Access or /login is a failure", async () => {
  const failures = await checkLiveGated(ORIGIN,
    site({ "/api/graph": { status: 302, location: "https://evil.test/" } }).fetcher);
  assert.equal(failures.length, 1);
});

test("a public site that stopped serving the public document is a failure", async () => {
  assert.equal((await checkLiveGated(ORIGIN, site({ "/graph.json": { status: 200, body: { mode: "private" } } }).fetcher)).length, 1);
  assert.equal((await checkLiveGated(ORIGIN, site({ "/graph.json": { status: 404 } }).fetcher)).length, 1);
});
