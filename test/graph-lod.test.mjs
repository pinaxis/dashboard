import { test } from "node:test";
import assert from "node:assert/strict";
import { importance, thresholdForZoom } from "../src/graph/scene.ts";

test("importance ranks a node by the stronger of its severity and its reach", () => {
  assert.ok(importance("HIGH", 0) > importance("LOW", 0), "a high node outranks a peripheral low one");
  assert.ok(importance("LOW", 1) > importance("LOW", 0), "a well-connected low node is more important than a peripheral one");
  assert.equal(importance("CRITICAL", 0), 1);
  assert.ok(importance("MEDIUM", 0) > importance("LOW", 0.3));
  assert.equal(importance("LOW", -2), importance("LOW", 0), "reach is clamped at zero");
});

test("thresholdForZoom hides more when zoomed out and reveals detail as you zoom in", () => {
  const far = thresholdForZoom(3);
  const mid = thresholdForZoom(1);
  const near = thresholdForZoom(0.4);
  const deep = thresholdForZoom(0.05);
  assert.ok(far > mid, "a wide overview shows fewer nodes than a mid zoom");
  assert.ok(mid > near);
  assert.ok(near > deep);
  assert.equal(deep, 0, "fully zoomed in shows everything");
  assert.ok(far <= 1);
});

test("a peripheral low node is hidden at the overview but shown when zoomed in", () => {
  const peripheral = importance("LOW", 0);
  assert.ok(peripheral < thresholdForZoom(3), "hidden at the overview");
  assert.ok(peripheral >= thresholdForZoom(0.05), "shown when fully zoomed in");
});
