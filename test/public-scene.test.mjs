import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryColor, categorySize } from "../src/graph/scene.ts";

test("each category kind gets its own colour", () => {
  const colors = new Set(["credential", "extension", "band", "repositories"].map((kind) => categoryColor(kind)));
  assert.equal(colors.size, 4);
});

test("size grows with count but stays bounded", () => {
  assert.ok(categorySize(1000, 1000) >= categorySize(5, 1000));
  assert.ok(categorySize(1000, 1000) <= 30);
  assert.ok(categorySize(5, 1000) >= 2.5);
});
