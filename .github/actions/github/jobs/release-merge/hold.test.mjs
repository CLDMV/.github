#!/usr/bin/env node
/**
 * @fileoverview Unit tests for release-merge's deps-only hold helper. Run: `node test.mjs`.
 */

import { hasHoldLabel } from "./action.mjs";

let failures = 0;
function eq(actual, expected, label) {
	if (actual === expected) console.log(`  ✅ ${label}`);
	else {
		console.error(`  ❌ ${label}: expected ${expected}, got ${actual}`);
		failures++;
	}
}

console.log("hasHoldLabel:");
eq(hasHoldLabel({ labels: [{ name: "release" }, { name: "release: deps-only" }] }, "release: deps-only"), true, "label present");
eq(hasHoldLabel({ labels: [{ name: "Release: Deps-Only" }] }, "release: deps-only"), true, "case-insensitive");
eq(hasHoldLabel({ labels: [{ name: "release" }] }, "release: deps-only"), false, "label absent");
eq(hasHoldLabel({ labels: [] }, "release: deps-only"), false, "no labels");
eq(hasHoldLabel({}, "release: deps-only"), false, "labels missing");
eq(hasHoldLabel({ labels: [{ name: "release: deps-only" }] }, ""), false, "empty hold label disables");

if (failures) process.exit(1);
console.log("\nAll release-merge tests passed");
