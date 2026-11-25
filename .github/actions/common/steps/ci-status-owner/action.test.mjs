#!/usr/bin/env node
/**
 * @fileoverview Tests for the ci-status-owner action's decision.
 * Run via `npm test` from the repo root.
 */

import { decide, isBumpCommit, parsePrefixes } from "./action.mjs";

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

const SHA = "f8be6af2" + "0".repeat(32);
const prefixes = parsePrefixes("chore: bump version");
const pr = (head, fork = false) => ({ pull_request: { head: { ref: head, sha: SHA, repo: { fork } } } });
const msg = (m) => async () => m;
const boom = async () => {
	throw new Error("GitHub API 500");
};
const never = async () => {
	throw new Error("should not read the commit");
};

console.log("parsePrefixes / isBumpCommit:");
eq(parsePrefixes(" chore: bump version , release: ,"), ["chore: bump version", "release:"], "trims and drops empties");
eq(isBumpCommit("chore: bump version to 1.2.3\n\nbody", prefixes), true, "bump commit matches");
eq(isBumpCommit("Merge pull request #947 from x/y", prefixes), false, "merge commit doesn't");
eq(isBumpCommit("feat: chore: bump version", prefixes), false, "prefix must lead");

console.log("decide:");
const owns = async (args) => (await decide({ prefixes, readMessage: never, ...args })).owns;
eq(await owns({ eventName: "push", event: {} }), true, "push owns");
eq(await owns({ eventName: "workflow_dispatch", event: {} }), true, "workflow_dispatch owns");
eq(await owns({ eventName: "pull_request", event: pr("feat/x", true) }), true, "fork PR owns");
eq(await owns({ eventName: "pull_request", event: pr("next", true) }), true, "fork PR named next owns without a lookup");
eq(await owns({ eventName: "pull_request", event: pr("feat/x") }), false, "in-repo feature PR doesn't own");
eq(
	await owns({ eventName: "pull_request", event: pr("next"), readMessage: msg("chore: bump version to 3.13.0") }),
	true,
	"release PR at a bump commit owns"
);
eq(
	await owns({ eventName: "pull_request", event: pr("hotfixes"), readMessage: msg("chore: bump version to 3.12.4") }),
	true,
	"hotfix release PR at a bump commit owns"
);
eq(
	await owns({ eventName: "pull_request", event: pr("next"), readMessage: msg("feat(api): x (#947)\n\nMerge body") }),
	false,
	"release PR at a feature merge doesn't own (the #531 case)"
);
eq(
	await owns({ eventName: "pull_request", event: pr("next"), readMessage: msg("Merge branch 'master' into next") }),
	false,
	"release PR at the base→next sync merge doesn't own"
);
let r = await decide({ eventName: "pull_request", event: pr("next"), prefixes, readMessage: boom });
eq([r.owns, r.warn], [true, true], "lookup failure fails safe: owns, with a warning");
r = await decide({
	eventName: "pull_request",
	event: { pull_request: { head: { ref: "next", repo: { fork: false } } } },
	prefixes,
	readMessage: never
});
eq([r.owns, r.warn], [true, true], "missing head SHA fails safe");

if (failures) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log("\nAll ci-status-owner tests passed.");
