#!/usr/bin/env node
/**
 * @fileoverview Unit tests for redirect-hotfix-pr pure logic.
 * Run: `node test.mjs`. No network — only exercises exported functions.
 */

import { compilePattern, shouldSkip, buildCommentBody, COMMENT_SENTINEL } from "./action.mjs";

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

console.log("\nshouldSkip:");
const pat = compilePattern("");
eq(
	shouldSkip({ userType: "Bot", headRef: "hotfix/x", baseRef: "next", targetBase: "hotfixes", headPattern: pat }),
	{ skip: true, reason: "PR author is a Bot" },
	"bot → skip"
);
eq(
	shouldSkip({ userType: "User", headRef: "feat/x", baseRef: "next", targetBase: "hotfixes", headPattern: pat }),
	{ skip: true, reason: `Head 'feat/x' does not match hotfix pattern ${pat}` },
	"non-hotfix head → skip"
);
eq(
	shouldSkip({ userType: "User", headRef: "hotfix/x", baseRef: "hotfixes", targetBase: "hotfixes", headPattern: pat }),
	{ skip: true, reason: "PR already targets 'hotfixes'" },
	"already on target base → skip"
);
eq(
	shouldSkip({ userType: "User", headRef: "hotfix/x", baseRef: "next", targetBase: "hotfixes", headPattern: pat }),
	{ skip: false, reason: "" },
	"hotfix branch, not yet redirected → proceed"
);
eq(
	shouldSkip({ userType: "User", headRef: "security/cve-1234", baseRef: "next", targetBase: "hotfixes", headPattern: pat }),
	{ skip: false, reason: "" },
	"security/ branch also redirected"
);
eq(
	shouldSkip({ userType: "User", headRef: "", baseRef: "next", targetBase: "hotfixes", headPattern: pat }),
	{ skip: true, reason: `Head '' does not match hotfix pattern ${pat}` },
	"empty head → skip"
);

console.log("\nbuildCommentBody:");
const body = buildCommentBody("next", "hotfixes");
eq(body.startsWith(COMMENT_SENTINEL), true, "comment starts with sentinel");
eq(body.includes("`next`"), true, "comment includes old base");
eq(body.includes("`hotfixes`"), true, "comment includes new base");

console.log("\nCOMMENT_SENTINEL:");
eq(typeof COMMENT_SENTINEL === "string" && COMMENT_SENTINEL.length > 0, true, "sentinel is non-empty");
eq(COMMENT_SENTINEL !== "_Auto-normalized PR title:_", true, "sentinel differs from normalize-pr-title's sentinel");

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
