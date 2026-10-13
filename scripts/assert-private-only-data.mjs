import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GRAPH = "api/graph.json";

function filesUnder(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/**
 * @remarks the private Worker serves nothing but this file, and only after its own Access check; any
 * other file in the directory is unexplained, and the gate refuses it rather than guessing.
 */
export function assertPrivateOnlyData(root) {
  const files = filesUnder(root).map((path) => relative(root, path).split("\\").join("/")).sort();
  assert.deepEqual(files, [GRAPH],
    `the private build must hold exactly ${GRAPH}, found: ${files.join(", ") || "nothing"}`);
  const document = JSON.parse(readFileSync(join(root, GRAPH), "utf8"));
  assert.equal(document.mode, "private", `${GRAPH} is not a private-mode document`);
  return files.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const count = assertPrivateOnlyData(join(root, process.argv[2] ?? "dist-private"));
  console.log(`private build holds only ${GRAPH} (${count} file)`);
}
