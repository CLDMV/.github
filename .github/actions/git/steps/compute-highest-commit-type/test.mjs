#!/usr/bin/env node
/**
 * @fileoverview Unit tests for compute-highest-commit-type pure logic.
 * Run directly: `node test.mjs` in this directory. Exits non-zero on failure.
 */

import { parseCommit, computeHighest, bumpFor, TYPE_PRIORITY } from "./action.mjs";

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

console.log("parseCommit:");
eq(parseCommit("feat: add foo"), { type: "feat", isBreaking: false }, "plain feat");
eq(parseCommit("fix(parser): handle empty input"), { type: "fix", isBreaking: false }, "fix with scope");
eq(parseCommit("feat!: drop legacy API"), { type: "feat", isBreaking: true }, "feat with breaking mark");
eq(parseCommit("chore(deps)!: bump major dep"), { type: "chore", isBreaking: true }, "scoped + breaking mark");
eq(
	parseCommit("feat: add foo", "BREAKING CHANGE: removes /v1"),
	{ type: "feat", isBreaking: true },
	"breaking via body footer"
);
eq(
	parseCommit("feat: add foo", "BREAKING-CHANGE: removes /v1"),
	{ type: "feat", isBreaking: true },
	"breaking via hyphenated body footer"
);
eq(parseCommit("Merge pull request #10 from foo"), null, "non-conventional → null");
eq(parseCommit("FEAT: caps"), null, "uppercase type rejected");
eq(parseCommit(""), null, "empty subject");
eq(parseCommit(null), null, "null subject");

console.log("\nbumpFor:");
eq(bumpFor("feat", false), "minor", "feat → minor");
eq(bumpFor("fix", false), "patch", "fix → patch");
eq(bumpFor("perf", false), "patch", "perf → patch");
eq(bumpFor("revert", false), "patch", "revert → patch");
eq(bumpFor("chore", false), "none", "chore → none");
eq(bumpFor("docs", false), "none", "docs → none");
eq(bumpFor("feat", true), "major", "feat + breaking → major");
eq(bumpFor("chore", true), "major", "chore + breaking → major");
eq(bumpFor("", false), "none", "empty type → none");

console.log("\ncomputeHighest:");
eq(
	computeHighest([
		{ subject: "chore: cleanup", body: "" },
		{ subject: "feat: add foo", body: "" },
		{ subject: "fix: bar", body: "" }
	]),
	{ highestType: "feat", isBreaking: false, bump: "minor" },
	"feat wins over fix + chore"
);
eq(
	computeHighest([
		{ subject: "fix: bar", body: "" },
		{ subject: "chore: cleanup", body: "" }
	]),
	{ highestType: "fix", isBreaking: false, bump: "patch" },
	"fix wins over chore"
);
eq(
	computeHighest([
		{ subject: "chore!: rip out v1", body: "" }
	]),
	{ highestType: "chore", isBreaking: true, bump: "major" },
	"breaking outranks bump category — chore! → major"
);
eq(
	computeHighest([
		{ subject: "feat: add foo", body: "BREAKING CHANGE: removes /v1" }
	]),
	{ highestType: "feat", isBreaking: true, bump: "major" },
	"footer-declared breaking → major"
);
eq(
	computeHighest([]),
	{ highestType: "", isBreaking: false, bump: "none" },
	"empty list → all defaults"
);
eq(
	computeHighest([
		{ subject: "Merge pull request #10 from foo" },
		{ subject: "non-conventional message" }
	]),
	{ highestType: "", isBreaking: false, bump: "none" },
	"all non-conventional → all defaults"
);
eq(
	computeHighest([
		{ subject: "weirdtype: a new category" },
		{ subject: "fix: bar" }
	]),
	{ highestType: "fix", isBreaking: false, bump: "patch" },
	"unknown type ranks below known types"
);
eq(
	computeHighest([
		{ subject: "weirdtype: foo" }
	]),
	{ highestType: "weirdtype", isBreaking: false, bump: "none" },
	"unknown type still surfaces when only choice (bump=none)"
);

console.log("\nTYPE_PRIORITY ordering:");
eq(TYPE_PRIORITY[0], "feat", "feat is first");
eq(TYPE_PRIORITY[1], "fix", "fix is second");
eq(TYPE_PRIORITY.indexOf("perf") < TYPE_PRIORITY.indexOf("refactor"), true, "perf ranks above refactor");

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
