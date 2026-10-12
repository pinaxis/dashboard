import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildCrawl } from "../scripts/lib/crawl.mjs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SQL = await require("sql.js")();

function crawlOf(runs = [], db = new SQL.Database(readFileSync(join(root, "scratch", "fixture.db")))) {
  try {
    return buildCrawl(db, { dataset: "dataset-v4", since: "2026-09-01T00:00:00Z", runs });
  } finally {
    db.close();
  }
}

const run = (at, workflow = "scan") => ({ at, workflow, conclusion: "success", url: `https://example.test/${at}` });

test("a target row counts what was found and what is still queued", () => {
  assert.deepEqual(crawlOf().targets, [
    { target: "gcp-api-key", discovered: 1, pending: 0, complete: true },
    { target: "github-token", discovered: 1, pending: 5, complete: false },
    { target: "npm-package", discovered: 1, pending: 0, complete: true },
    { target: "openai-api-key", discovered: 1, pending: 0, complete: true },
  ]);
});

test("a source row counts its queued queries", () => {
  assert.deepEqual(crawlOf().sources, [{ source: "github", pending: 5 }]);
});

test("dataset and since pass through", () => {
  const crawl = crawlOf();
  assert.equal(crawl.dataset, "dataset-v4");
  assert.equal(crawl.since, "2026-09-01T00:00:00Z");
});

test("each run counts the nodes first seen before the next newer run", () => {
  const runs = crawlOf([run("2026-09-14T09:00:00Z"), run("2026-09-15T09:00:00Z", "resume")]).runs;
  assert.deepEqual(runs.map((entry) => [entry.workflow, entry.stored]), [["resume", 4], ["scan", 5]]);
});

test("nodes first seen before every run belong to none", () => {
  assert.deepEqual(crawlOf([run("2026-09-14T11:00:00Z")]).runs.map((entry) => entry.stored), [4]);
});

test("runs are newest first and capped at fifty", () => {
  const many = Array.from({ length: 60 }, (_, minute) =>
    run(new Date(Date.UTC(2026, 9, 12, 9, minute)).toISOString()));
  const runs = crawlOf(many).runs;
  assert.equal(runs.length, 50);
  assert.equal(runs[0].at, many[59].at);
});

test("a nanosecond first_seen after a whole-second run start lands in that run", () => {
  const db = new SQL.Database();
  db.run(`CREATE TABLE node (id INTEGER PRIMARY KEY, target TEXT NOT NULL DEFAULT '', first_seen TEXT NOT NULL);
    CREATE TABLE pending (source TEXT, target TEXT, query TEXT);
    INSERT INTO node (target, first_seen) VALUES ('openai-api-key', '2026-10-12T09:05:26.032562032Z');`);
  assert.deepEqual(crawlOf([run("2026-10-12T09:05:26Z")], db).runs.map((entry) => entry.stored), [1]);
});
