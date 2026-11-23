#!/usr/bin/env node
/**
 * @fileoverview Unit tests for check-release-commit pure helpers, focused on
 * title-suffix generation — specifically the fix that stops the version from
 * doubling on an explicit `release: vX.Y.Z - <desc>` commit. Run: `node test.mjs`.
 */

import { stripConventionalPrefix, stripLeadingVersion, computeTitleSuffix, titleSuffixCandidates, isAlreadyBumped } from "./action.mjs";

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

console.log("\ncomputeTitleSuffix — not truncated (the cap applies to the finished title, #523):");
eq(
	computeTitleSuffix(
		{},
		[{ subject: "feat(k3s-test): --stall stops a run with no output, --hold keeps the pod for --exec", category: "feature" }],
		{ versionBump: "minor" }
	),
	"--stall stops a run with no output, --hold keeps the pod for --exec",
	"long feat subject comes back whole"
);

console.log("\ntitleSuffixCandidates:");
{
	const commits = [
		{ subject: "chore: tidy", category: "chore" },
		{ subject: "fix: a bug", category: "fix" },
		{ subject: "feat: newer feature", category: "feature" },
		{ subject: "release: v2.0.0 - explicit desc", category: "release" },
		{ subject: "docs: oldest commit", category: "docs" }
	];
	const c = titleSuffixCandidates(commits);
	for (const want of ["a bug", "newer feature", "explicit desc", "v2.0.0 - explicit desc", "oldest commit", "tidy"]) {
		eq(c.includes(want), true, `includes "${want}"`);
	}
	eq(new Set(c).size, c.length, "no duplicates");
	const capped = titleSuffixCandidates(commits, 40);
	eq(capped[0], "a bug", "byte cap keeps suffix-driving commits first");
	eq(capped.includes("tidy"), false, "byte cap drops the rest");
}

console.log("\nisAlreadyBumped:");
eq(isAlreadyBumped(new Set(["0.0.1"]), "0.0.1", "0.0.1"), true, "bumped and package.json matches → applied");
eq(isAlreadyBumped(new Set(["0.0.1", "0.0.2"]), "0.0.1", "0.0.2"), false, "bumped earlier but package.json moved on → bump again");
eq(isAlreadyBumped(new Set(["0.0.1"]), "0.0.1", ""), true, "package.json unreadable → trust the bump commit");
eq(isAlreadyBumped(new Set(), "0.0.1", "0.0.1"), false, "no bump commit for the target → not applied");
eq(isAlreadyBumped(new Set(["0.0.2"]), "0.0.1", "0.0.2"), false, "only a different version bumped → not applied");

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
