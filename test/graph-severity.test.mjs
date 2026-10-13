import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeSize, severityFill } from "../src/graph/scene.ts";
import { BAND_COLOR } from "../src/lib/palette.ts";

test("nodeSize lets severity dominate reach, so a severe node beats a well-connected low one", () => {
  assert.ok(nodeSize("HIGH", 0) > nodeSize("LOW", 1), "a high node with no reach outsizes a low node with full reach");
  assert.ok(nodeSize("CRITICAL", 0) >= nodeSize("HIGH", 0));
  assert.ok(nodeSize("HIGH", 0) > nodeSize("MEDIUM", 1));
  assert.ok(nodeSize("MEDIUM", 0) > nodeSize("LOW", 0));
});

test("nodeSize still gives reach a secondary bump within a band", () => {
  assert.ok(nodeSize("MEDIUM", 1) > nodeSize("MEDIUM", 0));
  assert.equal(nodeSize("LOW", 0), nodeSize("LOW", -5), "reach is floored at zero");
});

test("severityFill mutes a low node toward the surface and leaves severe nodes vivid", () => {
  assert.notEqual(severityFill("LOW", BAND_COLOR.LOW), BAND_COLOR.LOW);
  assert.equal(severityFill("HIGH", BAND_COLOR.HIGH), BAND_COLOR.HIGH);
  assert.equal(severityFill("MEDIUM", BAND_COLOR.MEDIUM), BAND_COLOR.MEDIUM);
});
