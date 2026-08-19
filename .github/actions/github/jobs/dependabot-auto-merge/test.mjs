#!/usr/bin/env node
/**
 * @fileoverview Unit tests for dependabot-auto-merge pure helpers.
 * Run directly: `node test.mjs` in this directory. Exits non-zero on failure.
 */

import {
	parseSemverBump,
	requiredCheckContextsFromRules,
	isNotFoundError,
	allowedMergeMethodsFromRules,
	chooseMergeMethod,
	isAlreadyMergeableError,
	isProtectedBase
} from "./_impl.mjs";

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
eq(
	requiredCheckContextsFromRules([{ type: "pull_request", parameters: { required_approving_review_count: 1 } }]),
	[],
	"pull_request-only → no checks"
);
eq(requiredCheckContextsFromRules([]), [], "empty array → no checks");
eq(requiredCheckContextsFromRules(null), [], "non-array (null) → no checks");
eq(requiredCheckContextsFromRules({ message: "Not Found" }), [], "object payload → no checks");
eq(
	requiredCheckContextsFromRules([{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "" }, {}] } }]),
	[],
	"blank/missing contexts filtered out"
);
eq(
	requiredCheckContextsFromRules([
		{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "  " }, { context: " ci " }] } }
	]),
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
eq(chooseMergeMethod("", []), "merge", "empty config + unrestricted → defaults to merge");
eq(chooseMergeMethod("", ["merge", "squash"]), "merge", "empty config → merge default when allowed");

console.log("isAlreadyMergeableError:");
eq(isAlreadyMergeableError('GraphQL errors: [{"message":"Pull request is in unstable status"}]'), true, "unstable status → fall back");
eq(isAlreadyMergeableError('GraphQL errors: [{"message":"Pull request is in clean status"}]'), true, "clean status → fall back");
eq(
	isAlreadyMergeableError('GraphQL errors: [{"message":"Auto merge is not allowed for this repository"}]'),
	false,
	"auto-merge disabled → rethrow"
);
eq(isAlreadyMergeableError("GraphQL 403: Resource not accessible by integration"), false, "permission error → rethrow");
eq(isAlreadyMergeableError(undefined), false, "non-string → rethrow");

console.log("isProtectedBase:");
// The whole point of the guard: a Dependabot security PR that GitHub opened
// against the default branch (master) must be refused so it can't auto-land.
eq(isProtectedBase("master", "master"), true, "base == detected default branch → protected");
eq(isProtectedBase("main", "main"), true, "base == detected default (main) → protected");
eq(isProtectedBase("trunk", "trunk"), true, "base == detected default (renamed 'trunk') → protected");
eq(isProtectedBase("next", "master"), false, "next is a valid auto-merge target → not protected");
eq(isProtectedBase("hotfixes", "master"), false, "hotfixes is a valid auto-merge target → not protected");
// master/main are refused unconditionally, even when the default can't be read
// from the PR payload — the guard must never silently open up.
eq(isProtectedBase("master", ""), true, "master with unknown default → protected (fallback)");
eq(isProtectedBase("main", undefined), true, "main with unknown default → protected (fallback)");
eq(isProtectedBase("next", ""), false, "next with unknown default → not protected");
// A default named neither master nor main is still refused when detected...
eq(isProtectedBase("trunk", ""), false, "unknown default + non-conventional base → not protected");
// ...and master/main stay protected even when the real default is something else.
eq(isProtectedBase("master", "next"), true, "master always protected even if default is 'next'");
eq(isProtectedBase("", "master"), false, "empty base → not protected (handled elsewhere)");

if (failures) {
	console.error(`\n${failures} test(s) failed.`);
	process.exit(1);
}
console.log("\nAll tests passed.");
