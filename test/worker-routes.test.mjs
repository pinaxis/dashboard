import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, validateStart } from "../worker/routes.ts";
import worker from "../worker/index.ts";

const ORIGIN = "https://pinaxis.intisy.dev";
const STATUS = { lock: { held: false }, paused: false, current: null, last: null };

function deps({ signedIn = true, github = {} } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      origin: ORIGIN,
      verify: async (token) => signedIn && token === "jwt",
      github: {
        status: async () => STATUS,
        start: async (inputs) => { calls.push(["start", inputs]); },
        pause: async () => { calls.push(["pause"]); },
        cancelCurrent: async () => { calls.push(["cancel"]); return "https://run/7"; },
        ...github,
      },
    },
  };
}

function request(path, { method = "GET", body, origin = ORIGIN, type = "application/json", token = "jwt" } = {}) {
  const headers = new Headers();
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  if (method === "POST") {
    if (origin) headers.set("Origin", origin);
    if (type) headers.set("Content-Type", type);
  }
  return new Request(`${ORIGIN}/private/api/crawl${path}`,
    { method, headers, body: method === "POST" ? JSON.stringify(body ?? {}) : undefined });
}

const json = async (response) => [response.status, await response.json()];

test("status answers the live crawl state without caching", async () => {
  const response = await handle(request(""), deps().deps);
  assert.deepEqual(await json(response.clone()), [200, STATUS]);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("no Access login is a 403 on every action", async () => {
  for (const [path, method] of [["", "GET"], ["/start", "POST"], ["/pause", "POST"], ["/cancel", "POST"]]) {
    const { deps: denied, calls } = deps({ signedIn: false });
    assert.equal((await handle(request(path, { method, body: { mode: "full" } }), denied)).status, 403);
    assert.deepEqual(calls, []);
  }
});

test("a POST from another origin is refused", async () => {
  const { deps: open, calls } = deps();
  assert.equal((await handle(request("/pause", { method: "POST", origin: "https://evil.test" }), open)).status, 403);
  assert.equal((await handle(request("/pause", { method: "POST", origin: null }), open)).status, 403);
  assert.deepEqual(calls, []);
});

test("a POST that is not JSON is refused", async () => {
  const { deps: open, calls } = deps();
  assert.equal((await handle(request("/pause", { method: "POST", type: "text/plain" }), open)).status, 403);
  assert.deepEqual(calls, []);
});

test("start dispatches the validated inputs and answers 202", async () => {
  const { deps: open, calls } = deps();
  const response = await handle(request("/start", { method: "POST", body: { mode: "test", maxSearches: 25 } }), open);
  assert.deepEqual(await json(response), [202, { started: "test" }]);
  assert.deepEqual(calls, [["start", { mode: "test", maxSearches: 25 }]]);
});

test("pause and cancel answer what they did", async () => {
  assert.deepEqual(await json(await handle(request("/pause", { method: "POST" }), deps().deps)), [200, { paused: true }]);
  assert.deepEqual(await json(await handle(request("/cancel", { method: "POST" }), deps().deps)),
    [200, { cancelled: "https://run/7" }]);
});

test("a GitHub failure is a 502 with its message", async () => {
  const failing = deps({ github: { status: async () => { throw new Error("GitHub GET /: HTTP 500"); } } }).deps;
  assert.deepEqual(await json(await handle(request(""), failing)), [502, { error: "GitHub GET /: HTTP 500" }]);
});

test("an invalid start body is a 400 and dispatches nothing", async () => {
  for (const body of [{}, { mode: "fast" }, { mode: "full", targets: "Bad Name" }, { mode: "full", maxSearches: 0 },
    { mode: "full", maxSearches: 1001 }, { mode: "full", maxSearches: 2.5 }, { mode: "full", discoveryPages: 11 },
    { mode: "full", extra: true }]) {
    const { deps: open, calls } = deps();
    assert.equal((await handle(request("/start", { method: "POST", body }), open)).status, 400, JSON.stringify(body));
    assert.deepEqual(calls, []);
  }
});

test("validateStart accepts a full crawl with nothing else, and a comma list of targets", () => {
  assert.deepEqual(validateStart({ mode: "full" }), { mode: "full" });
  assert.deepEqual(validateStart({ mode: "full", targets: "openai-api-key,npm-package" }),
    { mode: "full", targets: "openai-api-key,npm-package" });
});

test("an unknown action is a 404 and a wrong method a 405", async () => {
  assert.equal((await handle(request("/explode", { method: "POST" }), deps().deps)).status, 404);
  assert.equal((await handle(request("/pause"), deps().deps)).status, 405);
});

test("the worker hands every non-API path to the assets untouched", async () => {
  const seen = [];
  const env = { ASSETS: { fetch: async (incoming) => { seen.push(incoming.url); return new Response("asset"); } },
    GITHUB_TOKEN: "t", ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud" };
  const response = await worker.fetch(new Request(`${ORIGIN}/private/index.html`), env);
  assert.equal(await response.text(), "asset");
  assert.deepEqual(seen, [`${ORIGIN}/private/index.html`]);
});

test("the worker answers an API path itself and refuses it without a login", async () => {
  const env = { ASSETS: { fetch: async () => assert.fail("API reached the assets") },
    GITHUB_TOKEN: "t", ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud" };
  assert.equal((await worker.fetch(new Request(`${ORIGIN}/private/api/crawl`), env)).status, 403);
});
