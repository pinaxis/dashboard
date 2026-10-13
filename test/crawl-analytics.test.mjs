import { test } from "node:test";
import assert from "node:assert/strict";
import { targetProgress, throughput, queueBySource } from "../src/data/crawlAnalytics.ts";

const crawl = {
  dataset: "dataset-v5",
  targets: [
    { target: "github-token", discovered: 322, pending: 840, complete: false },
    { target: "cargo-crate", discovered: 300, pending: 0, complete: true },
    { target: "social", discovered: 0, pending: 0, complete: false },
  ],
  sources: [{ source: "github", pending: 6300 }],
  runs: [
    { workflow: "scan", at: "2026-10-13T05:00:00Z", conclusion: "success", url: "u1", stored: 1900 },
    { workflow: "resume", at: "2026-10-13T03:00:00Z", conclusion: "success", url: "u2", stored: 7300 },
  ],
};

test("targetProgress reports percent found and a status, busiest first", () => {
  const rows = targetProgress(crawl);
  assert.equal(rows[0].target, "github-token");
  assert.equal(rows[0].percent, Math.round((322 / 1162) * 100));
  assert.equal(rows[0].status, "queued");
  assert.equal(rows.find((r) => r.target === "cargo-crate").status, "done");
  assert.equal(rows.find((r) => r.target === "social").status, "idle");
});

test("throughput sums found, averages per run, and estimates runs to drain", () => {
  const t = throughput(crawl);
  assert.equal(t.found, 9200);
  assert.equal(t.runs, 2);
  assert.equal(t.avgPerRun, 4600);
  assert.equal(t.pending, 840);
  assert.equal(t.etaRuns, 1);
});

test("queueBySource shows each source's pending share", () => {
  const rows = queueBySource(crawl);
  assert.deepEqual(rows, [{ source: "github", pending: 6300, share: 100 }]);
});
