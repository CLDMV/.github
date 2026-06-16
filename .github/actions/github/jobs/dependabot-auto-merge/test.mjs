#!/usr/bin/env node
/**
 * @fileoverview Unit tests for dependabot-auto-merge pure helpers.
 * Run directly: `node test.mjs` in this directory. Exits non-zero on failure.
 */

import { parseSemverBump, requiredCheckContextsFromRules, isNotFoundError, allowedMergeMethodsFromRules, chooseMergeMethod } from "./_impl.mjs";

let failures = 0;

function eq(actual, expected, label) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (ok) {
		console.log(`  ✅ ${label}`);
	} else {
		console.error(`  ❌ ${label}`);
		console.error(`     expected: ${JSON.stringify(expected)}`);
		console.error(`     actual:   ${JSON.stringify(actual)}`);
		failures++;
	}
}

console.log("parseSemverBump:");
eq(parseSemverBump("Bump esbuild from 0.28.0 to 0.28.1"), { type: "patch", from: "0.28.0", to: "0.28.1" }, "patch bump");
eq(parseSemverBump("bump x from 1.2.0 to 1.3.0"), { type: "minor", from: "1.2.0", to: "1.3.0" }, "minor bump");
eq(parseSemverBump("bump x from 1.0.0 to 2.0.0"), { type: "major", from: "1.0.0", to: "2.0.0" }, "major bump");
eq(parseSemverBump("chore: unrelated title"), null, "unparseable → null");
eq(parseSemverBump(undefined), null, "undefined title → null");

console.log("requiredCheckContextsFromRules:");
eq(
	requiredCheckContextsFromRules([
		{ type: "pull_request", parameters: { required_approving_review_count: 0 } },
		{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "test" }, { context: "lint" }] } }
	]),
	["test", "lint"],
	"extracts contexts from a ruleset array"
);
eq(requiredCheckContextsFromRules([{ type: "pull_request", parameters: { required_approving_review_count: 1 } }]), [], "pull_request-only → no checks");
eq(requiredCheckContextsFromRules([]), [], "empty array → no checks");
eq(requiredCheckContextsFromRules(null), [], "non-array (null) → no checks");
eq(requiredCheckContextsFromRules({ message: "Not Found" }), [], "object payload → no checks");
eq(
	requiredCheckContextsFromRules([{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "" }, {}] } }]),
	[],
	"blank/missing contexts filtered out"
);
eq(
	requiredCheckContextsFromRules([{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "  " }, { context: " ci " }] } }]),
	["ci"],
	"whitespace-only dropped, surrounding whitespace trimmed"
);

console.log("isNotFoundError:");
eq(isNotFoundError("GET /rules/branches/next -> 404: Not Found"), true, "404 → true");
eq(isNotFoundError("GET /rules/branches/next -> 403: Forbidden"), false, "403 → false");
eq(isNotFoundError("GET /rules/branches/next -> 500: error"), false, "500 → false");
eq(isNotFoundError(undefined), false, "non-string → false");

console.log("allowedMergeMethodsFromRules:");
eq(
	allowedMergeMethodsFromRules([{ type: "pull_request", parameters: { allowed_merge_methods: ["merge"] } }]),
	["merge"],
	"reads allowed_merge_methods from the pull_request rule"
);
eq(
	allowedMergeMethodsFromRules([{ type: "pull_request", parameters: { allowed_merge_methods: ["SQUASH", "Merge"] } }]),
	["squash", "merge"],
	"lowercases method names"
);
eq(allowedMergeMethodsFromRules([{ type: "required_status_checks", parameters: {} }]), [], "no pull_request rule → empty");
eq(allowedMergeMethodsFromRules(null), [], "non-array → empty");

console.log("chooseMergeMethod:");
eq(chooseMergeMethod("squash", ["merge"]), "merge", "configured squash not allowed → falls back to merge");
eq(chooseMergeMethod("squash", ["squash", "merge"]), "squash", "configured squash allowed → kept");
eq(chooseMergeMethod("SQUASH", ["merge"]), "merge", "case-insensitive configured input");
eq(chooseMergeMethod("squash", []), "squash", "unrestricted ruleset → honor config");
eq(chooseMergeMethod("", ["rebase"]), "rebase", "empty config → first allowed");

if (failures) {
	console.error(`\n${failures} test(s) failed.`);
	process.exit(1);
}
console.log("\nAll tests passed.");
