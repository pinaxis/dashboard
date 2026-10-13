import { test } from "node:test";
import assert from "node:assert/strict";
import { promoteLiveSecrets } from "../src/data/graph.ts";

function doc() {
  return {
    mode: "private",
    nodes: [
      { type: "SECRET", band: "HIGH", validated: true, valid: true },
      { type: "SECRET", band: "MEDIUM", validated: true, valid: false },
      { type: "SECRET", band: "LOW", validated: false, valid: false },
      { type: "REPOSITORY", band: "HIGH" },
    ],
    stats: { bands: { CRITICAL: 0, HIGH: 2, MEDIUM: 1, LOW: 1 } },
  };
}

test("a confirmed-live secret is promoted to CRITICAL and the band counts follow", () => {
  const result = promoteLiveSecrets(doc());
  assert.equal(result.nodes[0].band, "CRITICAL", "the live secret becomes critical");
  assert.equal(result.nodes[1].band, "MEDIUM", "a dead secret is untouched");
  assert.equal(result.nodes[3].band, "HIGH", "a non-secret is untouched");
  assert.deepEqual(result.stats.bands, { CRITICAL: 1, HIGH: 1, MEDIUM: 1, LOW: 1 });
});

test("a document with no live secrets is returned unchanged", () => {
  const input = doc();
  input.nodes[0].valid = false;
  const result = promoteLiveSecrets(input);
  assert.equal(result.nodes[0].band, "HIGH");
  assert.deepEqual(result.stats.bands, { CRITICAL: 0, HIGH: 2, MEDIUM: 1, LOW: 1 });
});
