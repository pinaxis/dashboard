import { test } from "node:test";
import assert from "node:assert/strict";
import { expiring } from "../worker/memo.ts";

function clock() {
  let now = 0;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

test("a value is reused within its lifetime and reloaded after it", async () => {
  const time = clock();
  const memo = expiring(10_000, time.now);
  let loads = 0;
  const load = async () => ++loads;
  assert.equal(await memo.get(load), 1);
  time.advance(9_999);
  assert.equal(await memo.get(load), 1);
  time.advance(1);
  assert.equal(await memo.get(load), 2);
});

test("a failed load is not kept", async () => {
  const memo = expiring(10_000, clock().now);
  await assert.rejects(memo.get(async () => { throw new Error("HTTP 502"); }));
  assert.equal(await memo.get(async () => "fresh"), "fresh");
});

test("clear forces the next read to load", async () => {
  const memo = expiring(10_000, clock().now);
  await memo.get(async () => "old");
  memo.clear();
  assert.equal(await memo.get(async () => "new"), "new");
});
