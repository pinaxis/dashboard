import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildGraph } from "./lib/graph.mjs";
import { buildCrawl } from "./lib/crawl.mjs";
import { withLayout } from "./lib/layout.mjs";
import { buildPublicGraph, defaultPolicy } from "./lib/public.mjs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODE = process.argv[2] === "private" ? "private" : "public";
const REPO = "pinaxis/pinaxis";

/**
 * @remarks resolving the highest dataset-v<N> release means a schema bump in pinaxis repoints the
 * dashboard on its own, instead of needing a matching edit here.
 */
function dataset() {
  const listed = execFileSync("gh",
    ["release", "list", "--repo", REPO, "--limit", "100", "--json", "tagName"], { encoding: "utf8" });
  const versions = JSON.parse(listed)
    .map((release) => /^dataset-v(\d+)$/.exec(release.tagName))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  if (versions.length === 0) {
    throw new Error(`no dataset-v<N> release found on ${REPO}`);
  }
  const schemaVersion = Math.max(...versions);
  return { tag: `dataset-v${schemaVersion}`, schemaVersion };
}

const WORKFLOWS = { scan: "scan.yml", resume: "resume.yml" };

function gh(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));
}

function crawlRuns(since) {
  return Object.entries(WORKFLOWS).flatMap(([workflow, file]) =>
    gh(["run", "list", "--repo", REPO, "--workflow", file, "--limit", "50", "--json", "createdAt,conclusion,url"])
      .filter((entry) => Date.parse(entry.createdAt) >= Date.parse(since))
      .map((entry) => ({ at: entry.createdAt, workflow, conclusion: entry.conclusion || null, url: entry.url })));
}

const { tag, schemaVersion } = dataset();
let dir = null;
try {
  let path;
  if (process.env.PINAXIS_DB) {
    path = resolve(process.env.PINAXIS_DB);
  } else {
    dir = mkdtempSync(join(tmpdir(), "pinaxis-"));
    execFileSync("gh",
      ["release", "download", tag, "--repo", REPO, "--pattern", "pinaxis.db", "--dir", dir, "--clobber"],
      { stdio: "inherit" });
    path = join(dir, "pinaxis.db");
  }
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(path));
  let graph;
  if (MODE === "private") {
    graph = buildGraph(db, { schemaVersion });
    const { createdAt: since } = gh(["release", "view", tag, "--repo", REPO, "--json", "createdAt"]);
    graph.crawl = buildCrawl(db, { dataset: tag, since, runs: crawlRuns(since) });
  } else {
    graph = buildPublicGraph(db, defaultPolicy());
    graph.schema = schemaVersion;
  }
  db.close();
  // Public day-rounds generatedAt; the gate forbids a clock timestamp anywhere in a public document.
  // Layout is private only: the public category graph seeds and settles its own positions in the
  // browser, and a stored x/y would add fields the public gate rejects.
  const now = new Date().toISOString();
  const base = { ...graph, dataset: tag };
  const document = MODE === "private"
    ? withLayout({ ...base, generatedAt: now })
    : { ...base, generatedAt: now.slice(0, 10) };
  const output = MODE === "private"
    ? join(root, "dist-private", "api", "graph.json")
    : join(root, "public", "graph.json");
  if (MODE === "private") {
    rmSync(join(root, "dist-private"), { recursive: true, force: true });
  } else {
    rmSync(join(root, "public", "pinaxis.db"), { force: true });
    rmSync(join(root, "public", "summary.json"), { force: true });
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(document));
  console.log(`wrote ${MODE} graph to ${output} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
} finally {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
}
