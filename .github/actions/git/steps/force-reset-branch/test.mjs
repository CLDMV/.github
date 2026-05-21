#!/usr/bin/env node
/**
 * @fileoverview Unit tests for force-reset-branch pure logic.
 * Run: `node test.mjs`. Does not invoke git.
 */

import { buildPushArgs, isLeaseFailure, parseLsRemoteSha } from "./action.mjs";

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

console.log("buildPushArgs:");
eq(
	buildPushArgs({ remote: "origin", sourceRef: "master", targetBranch: "next" }),
	["push", "origin", "master:refs/heads/next", "--force-with-lease"],
	"master → next"
);
eq(
	buildPushArgs({ remote: "upstream", sourceRef: "abc123", targetBranch: "hotfix" }),
	["push", "upstream", "abc123:refs/heads/hotfix", "--force-with-lease"],
	"upstream remote + SHA source"
);

console.log("\nisLeaseFailure:");
eq(
	isLeaseFailure(" ! [rejected]  master -> refs/heads/next (stale info)\n"),
	true,
	"'stale info' classic lease rejection"
);
eq(
	isLeaseFailure("hint: failed to push some refs ... fetch first"),
	true,
	"'fetch first' counts as lease-style"
);
eq(
	isLeaseFailure("Rejected: --force-with-lease check failed"),
	true,
	"--force-with-lease in message"
);
eq(
	isLeaseFailure("Permission denied (publickey)"),
	false,
	"auth error not a lease failure"
);
eq(
	isLeaseFailure("fatal: remote: Repository not found"),
	false,
	"missing-repo not a lease failure"
);
eq(isLeaseFailure(""), false, "empty string");
eq(isLeaseFailure(null), false, "null input");
eq(isLeaseFailure(undefined), false, "undefined input");

console.log("\nparseLsRemoteSha:");
const sample = "deadbeef1234567890123456789012345678abcd\trefs/heads/next\nfeedface1234567890123456789012345678abcd\trefs/heads/master\n";
eq(
	parseLsRemoteSha(sample, "refs/heads/next"),
	"deadbeef1234567890123456789012345678abcd",
	"full ref match"
);
eq(
	parseLsRemoteSha(sample, "master"),
	"feedface1234567890123456789012345678abcd",
	"short name → full ref auto-resolved"
);
eq(
	parseLsRemoteSha(sample, "refs/heads/missing"),
	"",
	"missing ref → empty string"
);
eq(parseLsRemoteSha("", "next"), "", "empty output");
eq(parseLsRemoteSha(sample, ""), "", "empty ref");

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
