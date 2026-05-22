#!/usr/bin/env node
/**
 * @fileoverview Unit tests for check-release-commit pure helpers, focused on
 * title-suffix generation — specifically the fix that stops the version from
 * doubling on an explicit `release: vX.Y.Z - <desc>` commit. Run: `node test.mjs`.
 */

import { stripConventionalPrefix, stripLeadingVersion, computeTitleSuffix } from "./action.mjs";

let failures = 0;
function eq(actual, expected, label) {
	if (JSON.stringify(actual) === JSON.stringify(expected)) {
		console.log(`  ✅ ${label}`);
	} else {
		console.error(`  ❌ ${label}`);
		console.error(`     expected: ${JSON.stringify(expected)}`);
		console.error(`     actual:   ${JSON.stringify(actual)}`);
		failures++;
	}
}

console.log("stripConventionalPrefix:");
eq(stripConventionalPrefix("feat!: adopt flow"), "adopt flow", "feat! prefix");
eq(stripConventionalPrefix("release: v4.0.0 - adopt flow"), "v4.0.0 - adopt flow", "release: prefix (version still present)");
eq(stripConventionalPrefix("fix(api): bar"), "bar", "scoped prefix");

console.log("\nstripLeadingVersion:");
eq(stripLeadingVersion("v4.0.0 - adopt flow"), "adopt flow", "v-prefixed version + dash");
eq(stripLeadingVersion("4.0.0 - adopt flow"), "adopt flow", "bare version + dash");
eq(stripLeadingVersion("1.2.3: foo"), "foo", "version + colon");
eq(stripLeadingVersion("v4.0.0"), "", "version only → empty");
eq(stripLeadingVersion("adopt flow"), "adopt flow", "no leading version → unchanged");
eq(stripLeadingVersion("v2 only"), "v2 only", "partial (not X.Y.Z) → unchanged");
eq(stripLeadingVersion(""), "", "empty");

console.log("\ncomputeTitleSuffix — explicit release: commit (the dedup fix):");
eq(
	computeTitleSuffix({ normalRelease: { subject: "release: v4.0.0 - adopt staging-branch flow" } }, [], {}),
	"adopt staging-branch flow",
	"release: vX.Y.Z - desc → desc (no version doubling)"
);
eq(
	computeTitleSuffix({ breakingRelease: { subject: "release!: v5.0.0 - big break" } }, [], {}),
	"big break",
	"breaking release! also strips version"
);

console.log("\ncomputeTitleSuffix — no explicit release (falls back to bump-type commit):");
eq(
	computeTitleSuffix({}, [{ subject: "feat: add widgets", category: "feature" }], { versionBump: "minor" }),
	"add widgets",
	"minor bump → feat subject (unaffected by the version strip)"
);

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
