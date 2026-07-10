#!/usr/bin/env node
/**
 * @fileoverview Unit tests for redirect-hotfix-pr pure logic.
 * Run: `node test.mjs`. No network — only exercises exported functions.
 */

import {
	compilePattern,
	shouldSkip,
	buildCommentBody,
	isDependabotSecurityPR,
	buildReplacementBranchName,
	buildReplacementPrBody,
	buildSupersededCommentBody,
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

console.log("compilePattern:");
const defaultPattern = compilePattern("");
eq(defaultPattern.test("hotfix/foo"), true, "default pattern matches hotfix/foo");
eq(defaultPattern.test("security/x"), true, "default pattern matches security/x");
eq(defaultPattern.test("feat/x"), false, "default pattern rejects feat/x");
eq(defaultPattern.test("hotfix-foo"), false, "default pattern requires slash after hotfix");

const customPattern = compilePattern("^urgent/");
eq(customPattern.test("urgent/critical"), true, "custom 'urgent/' pattern matches");
eq(customPattern.test("hotfix/foo"), false, "custom pattern rejects original hotfix/");

console.log("\nisDependabotSecurityPR:");
eq(
	isDependabotSecurityPR({ userLogin: "octocat", prBody: "Bumps lodash from 1.0 to 1.1. GHSA-aaaa-bbbb-cccc" }),
	false,
	"non-dependabot login → false even with GHSA reference"
);
eq(isDependabotSecurityPR({ userLogin: "dependabot[bot]", prBody: "" }), false, "empty body → false");
eq(
	isDependabotSecurityPR({ userLogin: "dependabot[bot]", prBody: "Bumps lodash from 4.17.20 to 4.17.21." }),
	false,
	"routine bump body (no GHSA) → false"
);
eq(
	isDependabotSecurityPR({ userLogin: "dependabot[bot]", prBody: "Bumps lodash. See GHSA-aaaa-bbbb-cccc for details." }),
	true,
	"GHSA-id token in body → true"
);
eq(
	isDependabotSecurityPR({
		userLogin: "dependabot[bot]",
		prBody: "See https://github.com/advisories/GHSA-zzzz-yyyy-xxxx for details."
	}),
	true,
	"github.com/advisories/GHSA- URL in body → true"
);
eq(
	isDependabotSecurityPR({
		userLogin: "dependabot[bot]",
		prBody: "Mixed case GHSA-AbCd-1234-EfGh and uppercase HTTPS://GITHUB.COM/ADVISORIES/GHSA-1111-2222-3333"
	}),
	true,
	"case-insensitive matching on GHSA references"
);

console.log("\nshouldSkip:");
const pat = compilePattern("");

// Routine non-bot hotfix flow
eq(
	shouldSkip({ userType: "User", userLogin: "octocat", headRef: "hotfix/x", baseRef: "next", targetBase: "hotfixes", headPattern: pat, prBody: "" }),
	{ skip: false, reason: "", redirectKind: "hotfix" },
	"hotfix head, not yet redirected → proceed (kind=hotfix)"
);
eq(
	shouldSkip({ userType: "User", userLogin: "octocat", headRef: "security/cve-1234", baseRef: "next", targetBase: "hotfixes", headPattern: pat, prBody: "" }),
	{ skip: false, reason: "", redirectKind: "hotfix" },
	"security/ head → proceed (kind=hotfix)"
);

// Bot skipping (no GHSA reference)
eq(
	shouldSkip({ userType: "Bot", userLogin: "github-actions[bot]", headRef: "hotfix/x", baseRef: "next", targetBase: "hotfixes", headPattern: pat, prBody: "" }),
	{ skip: true, reason: "PR author is a Bot", redirectKind: null },
	"non-dependabot bot → skip even on hotfix head"
);
eq(
	shouldSkip({
		userType: "Bot",
		userLogin: "dependabot[bot]",
		headRef: "dependabot/npm_and_yarn/lodash-4.17.21",
		baseRef: "next",
		targetBase: "hotfixes",
		headPattern: pat,
		prBody: "Bumps lodash from 4.17.20 to 4.17.21."
	}),
	{ skip: true, reason: "PR author is a Bot", redirectKind: null },
	"dependabot routine bump (no GHSA) → skip"
);

// Dependabot security override
eq(
	shouldSkip({
		userType: "Bot",
		userLogin: "dependabot[bot]",
		headRef: "dependabot/npm_and_yarn/lodash-4.17.21",
		baseRef: "next",
		targetBase: "hotfixes",
		headPattern: pat,
		prBody: "Bumps lodash to fix GHSA-aaaa-bbbb-cccc"
	}),
	{ skip: false, reason: "", redirectKind: "dependabot-security" },
	"dependabot security (GHSA in body) → proceed (kind=dependabot-security)"
);
eq(
	shouldSkip({
		userType: "Bot",
		userLogin: "dependabot[bot]",
		headRef: "dependabot/npm_and_yarn/lodash-4.17.21",
		baseRef: "hotfixes",
		targetBase: "hotfixes",
		headPattern: pat,
		prBody: "Bumps lodash to fix GHSA-aaaa-bbbb-cccc"
	}),
	{ skip: true, reason: "PR already targets 'hotfixes'", redirectKind: null },
	"dependabot security already on hotfixes → skip"
);

// Existing skip paths still apply for non-bot non-matching
eq(
	shouldSkip({ userType: "User", userLogin: "octocat", headRef: "feat/x", baseRef: "next", targetBase: "hotfixes", headPattern: pat, prBody: "" }),
	{ skip: true, reason: `Head 'feat/x' does not match hotfix pattern ${pat}`, redirectKind: null },
	"non-hotfix head → skip"
);
eq(
	shouldSkip({ userType: "User", userLogin: "octocat", headRef: "hotfix/x", baseRef: "hotfixes", targetBase: "hotfixes", headPattern: pat, prBody: "" }),
	{ skip: true, reason: "PR already targets 'hotfixes'", redirectKind: null },
	"hotfix head already on target → skip"
);
eq(
	shouldSkip({ userType: "User", userLogin: "octocat", headRef: "", baseRef: "next", targetBase: "hotfixes", headPattern: pat, prBody: "" }),
	{ skip: true, reason: `Head '' does not match hotfix pattern ${pat}`, redirectKind: null },
	"empty head → skip"
);

console.log("\nbuildCommentBody:");
const hotfixBody = buildCommentBody("next", "hotfixes", "hotfix");
eq(hotfixBody.startsWith(COMMENT_SENTINEL), true, "hotfix-kind comment starts with sentinel");
eq(hotfixBody.includes("`next`"), true, "hotfix-kind comment includes old base");
eq(hotfixBody.includes("`hotfixes`"), true, "hotfix-kind comment includes new base");
eq(hotfixBody.includes("head branch looks like a hotfix"), true, "hotfix-kind comment explains head-branch trigger");

const depBody = buildCommentBody("next", "hotfixes", "dependabot-security");
eq(depBody.startsWith(COMMENT_SENTINEL), true, "dependabot-security comment starts with sentinel");
eq(depBody.includes("security advisory (GHSA)"), true, "dependabot-security comment mentions GHSA");
eq(depBody.includes("Dependabot"), true, "dependabot-security comment mentions Dependabot");

// Default kind for backwards compat
const defaultBody = buildCommentBody("next", "hotfixes");
eq(defaultBody.includes("head branch looks like a hotfix"), true, "buildCommentBody defaults to hotfix kind");

console.log("\nbuildReplacementBranchName:");
eq(buildReplacementBranchName(186), "hotfix-redirect/pr-186", "keys the branch name on the PR number");
eq(buildReplacementBranchName(186), buildReplacementBranchName(186), "deterministic for the same PR number");
eq(buildReplacementBranchName(180) === buildReplacementBranchName(186), false, "different PR numbers never collide");

console.log("\nbuildReplacementPrBody:");
const replacementBody = buildReplacementPrBody(186, "Bumps esbuild from 0.28.0 to 0.28.1.");
eq(replacementBody.includes("Supersedes #186"), true, "replacement body references the original PR number");
eq(replacementBody.includes("Bumps esbuild from 0.28.0 to 0.28.1."), true, "replacement body includes the original body");
eq(buildReplacementPrBody(186, "").startsWith("_Supersedes #186._"), true, "handles an empty original body without throwing");

console.log("\nbuildSupersededCommentBody:");
const supersededBody = buildSupersededCommentBody(999);
eq(supersededBody.startsWith(COMMENT_SENTINEL), true, "superseded comment starts with sentinel");
eq(supersededBody.includes("#999"), true, "superseded comment references the replacement PR number");

console.log("\nCOMMENT_SENTINEL:");
eq(typeof COMMENT_SENTINEL === "string" && COMMENT_SENTINEL.length > 0, true, "sentinel is non-empty");
eq(COMMENT_SENTINEL !== "_Auto-normalized PR title:_", true, "sentinel differs from normalize-pr-title's sentinel");

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
