#!/usr/bin/env node
/**
 * @fileoverview Unit tests for find-divergence's base-version parsing. Run: `node test.mjs`.
 * @module @cldmv/.github.git.steps.find-divergence.test
 */

import { baseVersionFromPackageJson, UNRELEASED_BASE_VERSION } from "./action.mjs";

let failures = 0;
function eq(actual, expected, label) {
	if (actual === expected) {
		console.log(`  ✅ ${label}`);
	} else {
		console.error(`  ❌ ${label}`);
		console.error(`     expected: ${JSON.stringify(expected)}`);
		console.error(`     actual:   ${JSON.stringify(actual)}`);
		failures++;
	}
}

console.log("baseVersionFromPackageJson:");
eq(baseVersionFromPackageJson('{"name":"x","version":"1.2.3"}'), "1.2.3", "version present");
eq(baseVersionFromPackageJson('{"name":"x","version":" 1.2.3 "}'), "1.2.3", "version trimmed");
eq(baseVersionFromPackageJson('{"name":"x"}'), UNRELEASED_BASE_VERSION, "no version field → 0.0.0 (never released)");
eq(baseVersionFromPackageJson('{"name":"x","version":""}'), UNRELEASED_BASE_VERSION, "empty version → 0.0.0");
eq(baseVersionFromPackageJson('{"name":"x","version":7}'), UNRELEASED_BASE_VERSION, "non-string version → 0.0.0");
eq(baseVersionFromPackageJson(""), "", "no package.json → unknown");
eq(baseVersionFromPackageJson("{not json"), "", "unparseable → unknown");
eq(baseVersionFromPackageJson("[]"), UNRELEASED_BASE_VERSION, "array JSON has no version → 0.0.0");
eq(baseVersionFromPackageJson("null"), "", "null JSON → unknown");

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
