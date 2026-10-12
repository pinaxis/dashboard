import { test } from "node:test";
import assert from "node:assert/strict";
import { describePublic } from "../src/data/publicView.ts";

const stats = {
  byCredential: [{ label: "openai-api-key", count: 6 }],
  byExtension: [{ label: ".env", count: 10 }],
  byBand: [{ label: "CRITICAL", count: 6 }],
  validity: { live: 6, dead: 7, formatOnly: 0 },
  monthly: [{ month: "2026-06", found: 10 }],
  total: 13,
  repositories: 9,
  asOf: "2026-08-02",
};

test("tiles report the totals and name the as-of date", () => {
  const { tiles, asOfNote } = describePublic(stats);
  const byLabel = new Map(tiles.map((tile) => [tile.label, tile.value]));
  assert.equal(byLabel.get("findings"), "13");
  assert.equal(byLabel.get("confirmed live"), "6");
  assert.equal(byLabel.get("repositories affected"), "9");
  assert.ok(asOfNote.includes("2026-08-02"));
  assert.ok(asOfNote.toLowerCase().includes("30"));
});

test("a suppressed zero reads as fewer than five, not absent", () => {
  const byLabel = new Map(describePublic(stats).tiles.map((tile) => [tile.label, tile.value]));
  assert.equal(byLabel.get("format only"), "fewer than 5");
});
