#!/usr/bin/env node
/**
 * @fileoverview Unit tests for force-reset-branch pure logic.
 * Run: `node test.mjs`. Does not invoke git.
 */

import { buildPushArgs, isLeaseFailure, parseLsRemoteSha, buildRemoteUrl, redactToken } from "./action.mjs";

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
	buildPushArgs({ remote: "origin", sourceRef: "master", targetBranch: "next", expectedSha: "deadbeef" }),
	["push", "origin", "master:refs/heads/next", "--force-with-lease=refs/heads/next:deadbeef"],
	"explicit lease with expected SHA"
);
eq(
	buildPushArgs({ remote: "upstream", sourceRef: "abc123", targetBranch: "hotfixes", expectedSha: "cafe1234" }),
	["push", "upstream", "abc123:refs/heads/hotfixes", "--force-with-lease=refs/heads/hotfixes:cafe1234"],
	"upstream remote + SHA source + explicit lease"
);
eq(
	buildPushArgs({ remote: "origin", sourceRef: "master", targetBranch: "next", expectedSha: "" }),
	["push", "origin", "master:refs/heads/next", "--force-with-lease=refs/heads/next:"],
	"empty expected SHA → must-not-exist lease (new branch)"
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

console.log("\nbuildRemoteUrl:");
eq(
	buildRemoteUrl("CLDMV/.github", "ghs_abc123"),
	"https://x-access-token:ghs_abc123@github.com/CLDMV/.github.git",
	"composes x-access-token URL"
);
eq(
	buildRemoteUrl("owner/repo", "tok"),
	"https://x-access-token:tok@github.com/owner/repo.git",
	"generic owner/repo"
);

console.log("\nredactToken:");
eq(
	redactToken("git push https://x-access-token:ghs_secret@github.com/o/r.git master:refs/heads/next --force-with-lease"),
	"git push https://x-access-token:***@github.com/o/r.git master:refs/heads/next --force-with-lease",
	"masks the token in a push command"
);
eq(
	redactToken("! [rejected] (stale info)"),
	"! [rejected] (stale info)",
	"leaves token-free strings unchanged"
);
eq(redactToken(null), null, "null passthrough");

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
