import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWindow } from "../src/graph/window.ts";

// five nodes: 0 important+far, 1 low+inside, 2 low+far, 3 low+far(pinned), 4 medium+far
const model = {
  importance: [0.9, 0.15, 0.15, 0.15, 0.5],
  x: [100, 1, 100, 100, 100],
  y: [100, 1, 100, 100, 100],
};
const bounds = { minX: 0, maxX: 10, minY: 0, maxY: 10 };

test("the window keeps important nodes, viewport nodes, and pinned nodes", () => {
  const win = computeWindow(model, bounds, 0.6, 100, new Set([3]));
  assert.ok(win.has(0), "an important node is kept even when off-screen");
  assert.ok(win.has(1), "a node inside the viewport is kept even when low");
  assert.ok(win.has(3), "a pinned node is kept even off-screen and low");
  assert.ok(!win.has(2), "a low node off-screen is dropped");
  assert.ok(!win.has(4), "a medium node below threshold and off-screen is dropped");
});

test("the window never exceeds the cap, keeping pinned then the most important", () => {
  const win = computeWindow(model, bounds, 0, 2, new Set([2]));
  assert.equal(win.size, 2);
  assert.ok(win.has(2), "pinned survives the cap");
  assert.ok(win.has(0), "the most important of the rest survives the cap");
});
