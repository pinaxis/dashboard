import { test } from "node:test";
import assert from "node:assert/strict";
import { isCrawlStatus, describeStatus } from "../src/data/crawlStatus.ts";

const good = { lock: { held: false }, paused: false, current: null, last: null };

test("isCrawlStatus accepts a well-formed status and rejects a malformed one", () => {
  assert.equal(isCrawlStatus(good), true);
  assert.equal(isCrawlStatus({}), false);
  assert.equal(isCrawlStatus({ lock: null }), false);
  assert.equal(isCrawlStatus(null), false);
  assert.equal(isCrawlStatus("nope"), false);
});

test("describeStatus never throws on a ready state with a malformed status", () => {
  const line = describeStatus({ kind: "ready", status: {} }, () => "now");
  assert.equal(line.tone, "unknown");
});
