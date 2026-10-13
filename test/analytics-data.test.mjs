import { test } from "node:test";
import assert from "node:assert/strict";
import { topPackages, coOccurrenceBars } from "../src/data/analytics.ts";

const doc = {
  nodes: [
    { type: "PACKAGE", target: "npm-package", label: "left-pad", popularity: 2200000, band: "LOW" },
    { type: "PACKAGE", target: "npm-package", label: "", popularity: 900000, band: "LOW" },
    { type: "PACKAGE", target: "pypi-package", label: "requests", popularity: null, band: "LOW" },
  ],
  stats: { coOccurrence: [{ a: "stripe-publishable-key", b: "stripe-secret-key", repositories: 11 }] },
};

test("topPackages labels every bar and drops a null-popularity package", () => {
  const bars = topPackages(doc);
  assert.equal(bars.length, 2);
  assert.ok(bars.every((bar) => bar.label.length > 0), "no nameless bar");
  assert.equal(bars[1].label, "npm-package", "a blank label falls back to the target");
});

test("coOccurrenceBars renders the pair label", () => {
  assert.equal(coOccurrenceBars(doc)[0].label, "stripe-publishable-key + stripe-secret-key");
});

import { packagesByEcosystem, hasNamedPackages } from "../src/data/analytics.ts";

const ecoDoc = {
  nodes: [
    { type: "PACKAGE", target: "npm-package", label: null, popularity: 100 },
    { type: "PACKAGE", target: "npm-package", label: null, popularity: 50 },
    { type: "PACKAGE", target: "pypi-package", label: null, popularity: 70 },
    { type: "PACKAGE", target: "stack-tool", label: null, popularity: 200 },
  ],
  stats: { coOccurrence: [] },
};

test("packagesByEcosystem sums popularity per target, sorted", () => {
  const bars = packagesByEcosystem(ecoDoc);
  assert.deepEqual(bars.map((b) => [b.label, b.value]), [["stack-tool", 200], ["npm-package", 150], ["pypi-package", 70]]);
});

test("hasNamedPackages is false when packages carry no real name", () => {
  assert.equal(hasNamedPackages(ecoDoc), false);
  assert.equal(hasNamedPackages({ nodes: [{ type: "PACKAGE", target: "npm-package", label: "left-pad", popularity: 1 }] }), true);
});
