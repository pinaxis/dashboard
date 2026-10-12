import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The private dashboard is reachable only at /private on a host whose root is public, and Cloudflare
 * Access protects that one path prefix. Anything the private Worker serves from outside it is
 * world-readable. That makes "every emitted file lives under private/" a disclosure rule, and a rule
 * worth checking against the build rather than against the config that is supposed to produce it.
 */
const SCOPE = "private";

function filesUnder(directory) {
  const out = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      out.push(...filesUnder(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

export function assertPrivateScoped(root) {
  const files = filesUnder(root).map((path) => relative(root, path).split("\\").join("/"));
  assert.ok(files.length > 0, "the private build produced no files at all");

  const escaped = files.filter((path) => !path.startsWith(`${SCOPE}/`));
  assert.deepEqual(escaped, [],
    `these files would be served outside the Access-protected /${SCOPE} path: ${escaped.join(", ")}`);

  const index = join(root, SCOPE, "index.html");
  const html = readFileSync(index, "utf8");
  const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  const rootAbsolute = referenced.filter((url) => url.startsWith("/") && !url.startsWith(`/${SCOPE}/`));
  assert.deepEqual(rootAbsolute, [],
    `index.html points outside /${SCOPE}, so these would load unprotected: ${rootAbsolute.join(", ")}`);

  return files.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const directory = join(root, process.argv[2] ?? "dist-private");
  const count = assertPrivateScoped(directory);
  console.log(`private build is scoped to /${SCOPE} (${count} files)`);
}
