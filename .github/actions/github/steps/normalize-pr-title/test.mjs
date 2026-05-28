#!/usr/bin/env node
/**
 * @fileoverview Unit tests for normalize-pr-title pure logic.
 * Run: `node test.mjs`. No network — only exercises exported functions.
 */

import {
	extractTitleParts,
	shouldSkip,
	titleConforms,
	buildNewTitle,
	summaryFromSubject,
	findRepresentativeCommit,
	COMMENT_SENTINEL
} from "./action.mjs";

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

console.log("extractTitleParts:");
eq(
	extractTitleParts("feat: add foo"),
	{ type: "feat", scope: "", breakingMark: false, summary: "add foo" },
	"plain feat title"
);
eq(
	extractTitleParts("fix(parser): handle empty input"),
	{ type: "fix", scope: "parser", breakingMark: false, summary: "handle empty input" },
	"fix with scope"
);
eq(
	extractTitleParts("chore(deps)!: bump major dep"),
	{ type: "chore", scope: "deps", breakingMark: true, summary: "bump major dep" },
	"scoped breaking"
);
eq(extractTitleParts("Some random title"), null, "non-conventional → null");
eq(extractTitleParts(""), null, "empty title → null");

console.log("\nshouldSkip:");
eq(
	shouldSkip({ userType: "Bot", userLogin: "dependabot[bot]", baseRef: "next", headRef: "deps/x", title: "chore: x" }),
	{ skip: true, reason: "PR author is a Bot" },
	"non-allowlisted bot user → skip"
);
eq(
	shouldSkip({ userType: "Bot", userLogin: "cldmv-bot[bot]", baseRef: "next", headRef: "feat/x", title: "test: x" }),
	{ skip: false, reason: "" },
	"cldmv-bot is allowlisted → no skip (our auto-PRs need normalization)"
);
eq(
	shouldSkip({ userType: "Bot", userLogin: "cldmv-bot[bot]", baseRef: "master", headRef: "next", title: "release: v3.3.0" }),
	{ skip: true, reason: "Release PR (next/hotfixes → master) — owned by the release flow" },
	"cldmv-bot release PR still skipped by the base/head rule"
);
eq(
	shouldSkip({ userType: "User", baseRef: "master", headRef: "next", title: "release: v3.3.0" }),
	{ skip: true, reason: "Release PR (next/hotfixes → master) — owned by the release flow" },
	"next → master → skip"
);
eq(
	shouldSkip({ userType: "User", baseRef: "master", headRef: "hotfixes", title: "release: v3.2.5" }),
	{ skip: true, reason: "Release PR (next/hotfixes → master) — owned by the release flow" },
	"hotfixes → master → skip"
);
eq(
	shouldSkip({ userType: "User", baseRef: "next", headRef: "feat/x", title: "release: emergency override" }),
	{ skip: true, reason: "Title starts with 'release:' — escape-hatch override" },
	"release: prefix → skip"
);
eq(
	shouldSkip({ userType: "User", baseRef: "next", headRef: "feat/x", title: "feat: add x" }),
	{ skip: false, reason: "" },
	"normal contributor PR → no skip"
);
eq(
	shouldSkip({ userType: "User", baseRef: "master", headRef: "feat/x", title: "feat: x" }),
	{ skip: false, reason: "" },
	"feature PR to master (rare) is not skipped — only release-PRs from next/hotfix are"
);

console.log("\ntitleConforms:");
eq(titleConforms("feat: x", "feat", false), true, "exact match");
eq(titleConforms("feat: x", "fix", false), true, "title type ranks higher (feat > fix)");
eq(titleConforms("chore: x", "feat", false), false, "title type ranks lower (chore < feat)");
eq(titleConforms("feat!: x", "feat", true), true, "breaking required + breaking marked");
eq(titleConforms("feat: x", "feat", true), false, "breaking required but not marked");
eq(titleConforms("Some title", "feat", false), false, "non-conventional title");
eq(titleConforms("feat: x", "", false), true, "no required type → conventional passes");

console.log("\nbuildNewTitle:");
eq(buildNewTitle({ type: "feat", isBreaking: false, summary: "add foo" }), "feat: add foo", "plain feat");
eq(buildNewTitle({ type: "feat", isBreaking: true, summary: "rip out v1" }), "feat!: rip out v1", "breaking feat");
eq(
	buildNewTitle({ type: "fix", isBreaking: false, summary: "bar", scope: "parser" }),
	"fix(parser): bar",
	"with scope"
);

console.log("\nsummaryFromSubject:");
eq(summaryFromSubject("feat: add foo"), "add foo", "plain feat strips prefix");
eq(summaryFromSubject("fix(scope)!: bar"), "bar", "scoped+breaking strips prefix");
eq(summaryFromSubject("just a regular subject"), "just a regular subject", "non-conventional passes through");

console.log("\nfindRepresentativeCommit (PR commits API order = oldest-first):");
const fixturesChrono = [
	{ subject: "feat: add foo", body: "" },         // oldest feat — should be picked
	{ subject: "fix: a small fix", body: "" },
	{ subject: "feat: add bar", body: "" },         // newer feat — not picked
	{ subject: "chore: cleanup", body: "" }         // newest
];
eq(
	findRepresentativeCommit(fixturesChrono, "feat")?.subject,
	"feat: add foo",
	"oldest matching feat picked (title stays pinned to original intent)"
);
eq(
	findRepresentativeCommit(fixturesChrono, "fix")?.subject,
	"fix: a small fix",
	"matches a non-feat type too"
);
eq(
	findRepresentativeCommit(fixturesChrono, "docs"),
	null,
	"no docs commit → null"
);
eq(findRepresentativeCommit([], "feat"), null, "empty input → null");
eq(findRepresentativeCommit(null, "feat"), null, "null input → null");

console.log("\nCOMMENT_SENTINEL:");
eq(typeof COMMENT_SENTINEL === "string" && COMMENT_SENTINEL.length > 0, true, "sentinel is a non-empty string");

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
