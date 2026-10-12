import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { route } from "../worker/site.ts";

const ORIGIN = "https://pinaxis.intisy.dev";
const GRAPH = JSON.stringify({ mode: "private", nodes: [], edges: [] });

function site({ signedIn = true, asset = new Response(GRAPH, { headers: { "Cache-Control": "public, max-age=600" } }) } = {}) {
  const seen = { assets: [], crawl: [] };
  return {
    seen,
    deps: {
      origin: ORIGIN,
      verify: async (token) => signedIn && token === "jwt",
      assets: { fetch: async (request) => { seen.assets.push(new URL(request.url).pathname); return asset.clone(); } },
      crawl: async (request) => { seen.crawl.push(new URL(request.url).pathname); return new Response("crawl"); },
    },
  };
}

function request(path, { method = "GET", token = "jwt" } = {}) {
  const headers = new Headers();
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  return new Request(`${ORIGIN}${path}`, { method, headers });
}

test("a signed-in /login goes home, with or without a trailing slash", async () => {
  for (const path of ["/login", "/login/"]) {
    const response = await route(request(path), site().deps);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("Location"), `${ORIGIN}/`);
  }
});

test("a /login whose token fails verification is a 403, never a redirect home", async () => {
  const response = await route(request("/login", { token: "expired" }), site().deps);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Location"), null);
});

test("a signed-in /api/graph serves the asset with a private, uncached header", async () => {
  const { deps, seen } = site();
  for (const path of ["/api/graph", "/api/graph/", "/api/graph?x=1"]) {
    const response = await route(request(path), deps);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Content-Type"), "application/json");
    assert.equal(await response.text(), GRAPH);
  }
  assert.deepEqual(seen.assets, ["/api/graph.json", "/api/graph.json", "/api/graph.json"]);
});

test("no token, or a bad one, reaches neither the assets nor the crawl", async () => {
  for (const token of [null, "forged"]) {
    const { deps, seen } = site();
    for (const path of ["/login", "/api/graph", "/api/crawl", "/api/crawl/start", "/anything"]) {
      assert.equal((await route(request(path, { token }), deps)).status, 403, `${path} ${token}`);
    }
    assert.deepEqual(seen, { assets: [], crawl: [] });
  }
});

test("a non-GET /api/graph is a 405 and touches no asset", async () => {
  const { deps, seen } = site();
  for (const method of ["POST", "HEAD", "DELETE"]) {
    assert.equal((await route(request("/api/graph", { method }), deps)).status, 405, method);
  }
  assert.deepEqual(seen.assets, []);
});

test("a missing graph asset is a 503 JSON error, not an HTML 404", async () => {
  const { deps } = site({ asset: new Response("<html>not found</html>", { status: 404 }) });
  const response = await route(request("/api/graph"), deps);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Content-Type"), "application/json");
  assert.match((await response.json()).error, /private graph is not deployed/);
});

test("the crawl API is handed the request untouched", async () => {
  const { deps, seen } = site();
  for (const path of ["/api/crawl", "/api/crawl/", "/api/crawl/pause"]) {
    assert.equal(await (await route(request(path), deps)).text(), "crawl");
  }
  assert.deepEqual(seen.crawl, ["/api/crawl", "/api/crawl/", "/api/crawl/pause"]);
});

test("the old /private paths redirect to /login, signed in or not", async () => {
  for (const token of ["jwt", null]) {
    for (const path of ["/private", "/private/", "/private/graph.json"]) {
      const response = await route(request(path, { token }), site().deps);
      assert.equal(response.status, 302, path);
      assert.equal(response.headers.get("Location"), `${ORIGIN}/login`);
    }
  }
});

test("a signed-in path the worker does not serve is a 404", async () => {
  assert.equal((await route(request("/api/other"), site().deps)).status, 404);
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the private worker runs first on every request and owns exactly its three routes", () => {
  const config = readFileSync(join(root, "wrangler.private.toml"), "utf8");
  assert.match(config, /^run_worker_first = true$/m);
  assert.match(config, /^directory = "\.\/dist-private"$/m);
  const routes = [...config.matchAll(/pattern = "([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(routes,
    ["pinaxis.intisy.dev/api/*", "pinaxis.intisy.dev/login*", "pinaxis.intisy.dev/private*"]);
  assert.doesNotMatch(config, /not_found_handling/);
});
