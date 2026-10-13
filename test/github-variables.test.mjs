import { test } from "node:test";
import assert from "node:assert/strict";
import { gitHub } from "../worker/github.ts";

function fakeFetch(routes) {
  const seen = [];
  const fetcher = async (url, init = {}) => {
    seen.push({ url, method: init.method ?? "GET", body: init.body });
    const key = `${init.method ?? "GET"} ${url}`;
    const handler = routes[key] ?? routes[url];
    return handler ?? new Response("", { status: 404 });
  };
  return { fetcher, seen };
}

const REPO = "https://api.github.com/repos/pinaxis/pinaxis";

test("getVariable returns the value, or null on 404", async () => {
  const hit = fakeFetch({ [`${REPO}/actions/variables/PINAXIS_WEIGHTS`]:
    new Response(JSON.stringify({ name: "PINAXIS_WEIGHTS", value: "github-token:8" }), { status: 200 }) });
  assert.equal(await gitHub("t", hit.fetcher).getVariable("PINAXIS_WEIGHTS"), "github-token:8");

  const miss = fakeFetch({});
  assert.equal(await gitHub("t", miss.fetcher).getVariable("PINAXIS_WEIGHTS"), null);
});

test("setVariable updates an existing variable, or creates it when absent", async () => {
  const update = fakeFetch({
    [`PATCH ${REPO}/actions/variables/PINAXIS_WEIGHTS`]: new Response(null, { status: 204 }),
  });
  await gitHub("t", update.fetcher).setVariable("PINAXIS_WEIGHTS", "github-token:9");
  assert.equal(update.seen.at(-1).method, "PATCH");

  const create = fakeFetch({
    [`PATCH ${REPO}/actions/variables/PINAXIS_WEIGHTS`]: new Response("", { status: 404 }),
    [`POST ${REPO}/actions/variables`]: new Response("", { status: 201 }),
  });
  await gitHub("t", create.fetcher).setVariable("PINAXIS_WEIGHTS", "github-token:9");
  assert.deepEqual(create.seen.map((call) => call.method), ["PATCH", "POST"]);
});
