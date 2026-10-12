import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchInputs, gitHub } from "../worker/github.ts";

const BASE = "https://api.github.com/repos/pinaxis/pinaxis";

function fake(routes) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const key = `${init.method ?? "GET"} ${url.replace(BASE, "")}`;
    calls.push({ key, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const route = routes[key];
    if (!route) {
      throw new Error(`unrouted ${key}`);
    }
    const answer = typeof route === "function" ? route() : route;
    const status = answer.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(answer.body ?? {}), { status });
  };
  return { client: gitHub("token-1", fetcher), calls };
}

const rawRun = (id, status, started, conclusion = null) => ({ id, status, conclusion,
  html_url: `https://github.com/pinaxis/pinaxis/actions/runs/${id}`, run_started_at: started, created_at: started });

function readRoutes({ lock = { status: 404 }, paused = { status: 404 }, scan = [], resume = [] } = {}) {
  return {
    "GET /git/ref/tags/crawl-lock": lock,
    "GET /git/tags/tag-sha": { body: { message: "runner-7\n", tagger: { date: "2026-10-12T10:00:00Z" } } },
    "GET /git/ref/tags/crawl-paused": paused,
    "GET /actions/workflows/scan.yml/runs?per_page=10": { body: { workflow_runs: scan } },
    "GET /actions/workflows/resume.yml/runs?per_page=10": { body: { workflow_runs: resume } },
  };
}

const WRITE_ROUTES = {
  "GET ": { body: { default_branch: "main" } },
  "GET /git/ref/heads/main": { body: { object: { type: "commit", sha: "head-sha" } } },
  "POST /git/refs": { status: 201, body: {} },
  "POST /actions/workflows/scan.yml/dispatches": { status: 204 },
};

test("status reads the lock holder and since from the annotated lock tag", async () => {
  const { client } = fake(readRoutes({ lock: { body: { object: { type: "tag", sha: "tag-sha" } } } }));
  assert.deepEqual((await client.status()).lock, { held: true, holder: "runner-7", since: "2026-10-12T10:00:00Z" });
});

test("a lightweight lock tag reads as held without a holder", async () => {
  const { client } = fake(readRoutes({ lock: { body: { object: { type: "commit", sha: "c" } } } }));
  assert.deepEqual((await client.status()).lock, { held: true });
});

test("absent lock and pause refs read as free and unpaused, a present pause ref as paused", async () => {
  assert.deepEqual(await fake(readRoutes()).client.status(),
    { lock: { held: false }, paused: false, current: null, last: null });
  assert.equal((await fake(readRoutes({ paused: { body: {} } })).client.status()).paused, true);
});

test("current is the newest active run and last the newest completed one, across both workflows", async () => {
  const status = await fake(readRoutes({
    scan: [rawRun(1, "completed", "2026-10-12T08:00:00Z", "success"), rawRun(3, "in_progress", "2026-10-12T10:00:00Z")],
    resume: [rawRun(2, "completed", "2026-10-12T09:00:00Z", "failure")],
  })).client.status();
  assert.deepEqual(status.current, { workflow: "scan", status: "in_progress", conclusion: null,
    url: "https://github.com/pinaxis/pinaxis/actions/runs/3", startedAt: "2026-10-12T10:00:00Z" });
  assert.equal(status.last.workflow, "resume");
  assert.equal(status.last.conclusion, "failure");
});

test("any failed read rejects instead of reporting idle", async () => {
  await assert.rejects(fake(readRoutes({ paused: { status: 500 } })).client.status(), /HTTP 500/);
  await assert.rejects(fake(readRoutes({ lock: { status: 502 } })).client.status(), /HTTP 502/);
});

test("requests carry the token and the API headers", async () => {
  const { client, calls } = fake(readRoutes());
  await client.status();
  for (const call of calls) {
    assert.equal(call.headers.Authorization, "Bearer token-1");
    assert.equal(call.headers.Accept, "application/vnd.github+json");
    assert.equal(call.headers["User-Agent"], "pinaxis-dashboard");
  }
});

test("a full start dispatches scan.yml on the default branch with engine defaults", async () => {
  const { client, calls } = fake(WRITE_ROUTES);
  await client.start({ mode: "full" });
  const dispatch = calls.find((call) => call.key === "POST /actions/workflows/scan.yml/dispatches");
  assert.deepEqual(dispatch.body, { ref: "main",
    inputs: { test: "false", targets: "", max_searches: "", discovery_pages: "" } });
});

test("a test start passes its inputs as strings", () => {
  assert.deepEqual(dispatchInputs({ mode: "test", targets: "openai-api-key", maxSearches: 25, discoveryPages: 1 }),
    { test: "true", targets: "openai-api-key", max_searches: "25", discovery_pages: "1" });
});

test("pause creates the pause ref at the default branch head when absent", async () => {
  const { client, calls } = fake({ ...WRITE_ROUTES, "GET /git/ref/tags/crawl-paused": { status: 404 } });
  await client.pause();
  assert.deepEqual(calls.find((call) => call.key === "POST /git/refs").body,
    { ref: "refs/tags/crawl-paused", sha: "head-sha" });
});

test("pause writes nothing when already paused", async () => {
  const { client, calls } = fake({ ...WRITE_ROUTES, "GET /git/ref/tags/crawl-paused": { body: {} } });
  await client.pause();
  assert.ok(!calls.some((call) => call.key === "POST /git/refs"));
});

test("a pause that loses a race to another pause still succeeds", async () => {
  let reads = 0;
  const { client } = fake({ ...WRITE_ROUTES, "POST /git/refs": { status: 422, body: {} },
    "GET /git/ref/tags/crawl-paused": () => (reads++ === 0 ? { status: 404 } : { body: {} }) });
  await client.pause();
});

test("a 422 that leaves the crawl unpaused fails", async () => {
  const { client } = fake({ ...WRITE_ROUTES, "POST /git/refs": { status: 422, body: {} },
    "GET /git/ref/tags/crawl-paused": { status: 404 } });
  await assert.rejects(client.pause(), /HTTP 422/);
});

test("cancel pauses before cancelling the active run", async () => {
  const { client, calls } = fake({ ...WRITE_ROUTES, ...readRoutes({ scan: [rawRun(7, "in_progress", "2026-10-12T10:00:00Z")] }),
    "POST /actions/runs/7/cancel": { status: 202, body: {} } });
  assert.deepEqual(await client.cancelCurrent(), ["https://github.com/pinaxis/pinaxis/actions/runs/7"]);
  const keys = calls.map((call) => call.key);
  assert.ok(keys.indexOf("POST /git/refs") < keys.indexOf("POST /actions/runs/7/cancel"));
});

test("cancel with nothing running still pauses and cancels nothing", async () => {
  const { client, calls } = fake({ ...WRITE_ROUTES, ...readRoutes() });
  assert.deepEqual(await client.cancelCurrent(), []);
  assert.ok(calls.some((call) => call.key === "POST /git/refs"));
});

test("a failed pause cancels nothing", async () => {
  const { client, calls } = fake({ ...WRITE_ROUTES, ...readRoutes({ scan: [rawRun(7, "in_progress", "2026-10-12T10:00:00Z")] }),
    "POST /git/refs": { status: 500, body: {} }, "POST /actions/runs/7/cancel": { status: 202, body: {} } });
  await assert.rejects(client.cancelCurrent());
  assert.ok(!calls.some((call) => call.key === "POST /actions/runs/7/cancel"));
});

test("current is the longest-running active run, not a resume that just started", async () => {
  const status = await fake(readRoutes({
    scan: [rawRun(3, "in_progress", "2026-10-12T08:00:00Z")],
    resume: [rawRun(4, "queued", "2026-10-12T11:00:00Z")],
  })).client.status();
  assert.equal(status.current.url, "https://github.com/pinaxis/pinaxis/actions/runs/3");
});

test("cancel cancels every active run once paused", async () => {
  const { client, calls } = fake({ ...WRITE_ROUTES, ...readRoutes({
    scan: [rawRun(3, "in_progress", "2026-10-12T08:00:00Z")],
    resume: [rawRun(4, "queued", "2026-10-12T11:00:00Z")] }),
    "POST /actions/runs/3/cancel": { status: 202, body: {} },
    "POST /actions/runs/4/cancel": { status: 202, body: {} } });
  assert.deepEqual(await client.cancelCurrent(), [
    "https://github.com/pinaxis/pinaxis/actions/runs/3",
    "https://github.com/pinaxis/pinaxis/actions/runs/4",
  ]);
  assert.ok(calls.some((call) => call.key === "POST /actions/runs/3/cancel"));
  assert.ok(calls.some((call) => call.key === "POST /actions/runs/4/cancel"));
});
