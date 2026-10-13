import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWeights, formatWeights, validateWeights } from "../worker/priorities.ts";

test("parseWeights reads a name:weight list, formatWeights is its inverse", () => {
  assert.deepEqual(parseWeights("github-token:8, openai-api-key:4"),
    { "github-token": 8, "openai-api-key": 4 });
  assert.deepEqual(parseWeights(null), {});
  assert.deepEqual(parseWeights("  "), {});
  assert.equal(formatWeights({ "github-token": 8, "openai-api-key": 4 }), "github-token:8,openai-api-key:4");
});

test("validateWeights accepts a clean map and rejects bad shapes", () => {
  assert.deepEqual(validateWeights({ weights: { "github-token": 8 } }), { "github-token": 8 });
  assert.equal(typeof validateWeights({ weights: { "github-token": 0 } }), "string");
  assert.equal(typeof validateWeights({ weights: { "github-token": 101 } }), "string");
  assert.equal(typeof validateWeights({ weights: { "Bad Name": 3 } }), "string");
  assert.equal(typeof validateWeights({ weights: { "github-token": 1.5 } }), "string");
  assert.equal(typeof validateWeights({ nope: 1 }), "string");
});
