import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePriorityInput } from "../src/data/priorities.ts";

test("validatePriorityInput accepts 1..100 integers and rejects the rest", () => {
  assert.equal(validatePriorityInput("8"), 8);
  assert.equal(validatePriorityInput("100"), 100);
  assert.equal(validatePriorityInput("0"), null);
  assert.equal(validatePriorityInput("101"), null);
  assert.equal(validatePriorityInput("1.5"), null);
  assert.equal(validatePriorityInput(""), null);
  assert.equal(validatePriorityInput("abc"), null);
});
