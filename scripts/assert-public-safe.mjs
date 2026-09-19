import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PSEUDONYM = /^(repo|owner)-[0-9a-f]{8}$/;
const PSEUDONYMOUS_TYPES = new Set(["REPOSITORY", "OWNER"]);
const FORBIDDEN_EDGES = new Set(["MAINTAINS", "CO_MAINTAINS"]);
const SECRET_BEARING_FIELDS = ["key", "label", "value"];

const SECRET_MARKERS = ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "sk_live_",
  "AIza", "BEGIN PRIVATE KEY", "BEGIN RSA PRIVATE KEY", "iam.gserviceaccount.com"];

/**
 * @remarks "sk-" is narrowed to the credential-bearing part of the document because three characters
 * collide with legitimate package names (the PyPI package "Flask-Login"), and PACKAGE labels are real
 * registry identifiers by design. The exclusion is scoped by node type, dropping the label only off
 * PACKAGE nodes, so a label on any other node type is still scanned regardless of what it says. A
 * future collision is answered by narrowing that one marker the same way, never by dropping a block
 * from the scan.
 */
const PACKAGE_COLLIDING_MARKER = "sk-";

export function assertPublicSafe(document) {
  assert.equal(document.mode, "public", "a public build must be served a document built in public mode");

  for (const node of document.nodes) {
    assert.notEqual(node.type, "MAINTAINER", "a public graph must carry no MAINTAINER node");
    if (node.type === "SECRET") {
      for (const field of SECRET_BEARING_FIELDS) {
        assert.ok(!(field in node), `a public SECRET node must not carry ${field}`);
      }
    }
    if (PSEUDONYMOUS_TYPES.has(node.type)) {
      assert.match(node.label, PSEUDONYM,
        `a public ${node.type} label must be a pseudonym, got ${node.label}`);
    }
  }

  for (const edge of document.edges) {
    assert.ok(!FORBIDDEN_EDGES.has(edge.type), `a public graph must carry no ${edge.type} edge`);
    if (edge.context !== undefined) {
      assert.ok(!edge.context.includes("/") && !edge.context.includes("\\"),
        `a public edge context must not be a path, got ${edge.context}`);
    }
  }

  const whole = JSON.stringify(document);
  for (const marker of SECRET_MARKERS) {
    assert.ok(!whole.includes(marker), `a public graph must not contain ${marker}`);
  }
  const scanned = {
    ...document,
    nodes: document.nodes.map((node) => (node.type === "PACKAGE"
      ? { ...node, label: undefined }
      : node)),
  };
  assert.ok(!JSON.stringify(scanned).includes(PACKAGE_COLLIDING_MARKER),
    `a public graph must not contain ${PACKAGE_COLLIDING_MARKER} outside registry identifiers`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  assertPublicSafe(JSON.parse(readFileSync(join(root, "public", "graph.json"), "utf8")));
  console.log("public graph is safe to publish");
}
