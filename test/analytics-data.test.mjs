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
