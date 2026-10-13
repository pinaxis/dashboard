import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeColor } from "../src/graph/scene.ts";
import { BAND_COLOR, TYPE_COLOR } from "../src/lib/palette.ts";

test("nodeColor uses the band in severity mode and the type in type mode", () => {
  const node = { type: "SECRET", band: "CRITICAL" };
  assert.equal(nodeColor(node, "severity"), BAND_COLOR.CRITICAL);
  assert.equal(nodeColor(node, "type"), TYPE_COLOR.SECRET);
});
