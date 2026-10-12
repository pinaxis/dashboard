import { test } from "node:test";
import assert from "node:assert/strict";
import { describeStatus } from "../src/data/crawlStatus.ts";

const relative = (iso) => `at ${iso}`;
const ready = (overrides) => ({ kind: "ready", status: { lock: { held: false }, paused: false, current: null, last: null, ...overrides } });
const run = { workflow: "scan", status: "in_progress", conclusion: null, url: "u", startedAt: "T1" };

test("a failed status read is unknown, never idle", () => {
  assert.deepEqual(describeStatus({ kind: "unknown", error: "HTTP 502" }, relative),
    { tone: "unknown", text: "Crawl status unknown: HTTP 502" });
  assert.equal(describeStatus({ kind: "loading" }, relative).tone, "unknown");
});

test("an active run is running, and says which workflow and since when", () => {
  assert.deepEqual(describeStatus(ready({ current: run }), relative),
    { tone: "running", text: "Crawl running (scan) since at T1" });
});

test("a held lock with no visible run still reads as running", () => {
  assert.deepEqual(describeStatus(ready({ lock: { held: true, holder: "runner-7", since: "T2" } }), relative),
    { tone: "running", text: "Crawl lock held by runner-7 since at T2" });
});

test("paused with nothing running says what a pause stops", () => {
  assert.equal(describeStatus(ready({ paused: true }), relative).tone, "paused");
});

test("nothing running and no pause is idle", () => {
  assert.deepEqual(describeStatus(ready({}), relative), { tone: "idle", text: "No crawl running" });
});
