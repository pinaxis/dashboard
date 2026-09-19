import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadSalt, createPseudonymizer } from "./lib/anonymize.mjs";
import { buildGraph } from "./lib/graph.mjs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODE = process.argv[2] === "private" ? "private" : "public";
const REPO = "intisy/pinaxis";

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

function fetchDatabase(tag) {
  if (process.env.PINAXIS_DB) {
    return { path: resolve(process.env.PINAXIS_DB), dir: null };
  }
  const dir = mkdtempSync(join(tmpdir(), "pinaxis-"));
  execFileSync("gh",
    ["release", "download", tag, "--repo", REPO, "--pattern", "pinaxis.db", "--dir", dir, "--clobber"],
    { stdio: "inherit" });
  return { path: join(dir, "pinaxis.db"), dir };
}

const { tag, schemaVersion } = dataset();
const salt = loadSalt({ root });
const { path, dir } = fetchDatabase(tag);
try {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(path));
  const graph = buildGraph(db, {
    mode: MODE,
    pseudonym: createPseudonymizer(salt, schemaVersion),
    schemaVersion,
  });
  db.close();
  const document = { ...graph, dataset: tag, generatedAt: new Date().toISOString() };
  rmSync(join(root, "public", "pinaxis.db"), { force: true });
  rmSync(join(root, "public", "summary.json"), { force: true });
  writeFileSync(join(root, "public", "graph.json"), JSON.stringify(document));
  console.log(`wrote ${MODE} graph.json (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
} finally {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
}
