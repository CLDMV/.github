#!/usr/bin/env node
/**
 * @fileoverview Unit tests for the pure helpers of the release-merge action:
 * isReleasePr (head/base classification), latestApprovalPresent (review
 * reduction with supersede/blocking semantics), and evaluateChecks (the
 * full-check-set gate: self-exclusion, pending vs failed vs passed, allow-list,
 * empty legacy statuses ignored). Run: `node test.mjs`.
 */

import { isReleasePr, latestApprovalPresent, evaluateChecks } from "./action.mjs";

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
function ok(cond, label) {
	if (cond) console.log(`  ✅ ${label}`);
	else {
		console.error(`  ❌ ${label}`);
		failures++;
	}
}

const integrationBranches = new Set(["next", "hotfixes"]);
const releaseBaseBranches = new Set(["master", "main"]);
const opts = { integrationBranches, releaseBaseBranches };

console.log("isReleasePr — head/base classification:");
ok(isReleasePr({ head: { ref: "next" }, base: { ref: "master" } }, opts), "next → master is a release PR");
ok(isReleasePr({ head: { ref: "hotfixes" }, base: { ref: "master" } }, opts), "hotfixes → master is a release PR");
ok(!isReleasePr({ head: { ref: "feat/x" }, base: { ref: "next" } }, opts), "feat/x → next is NOT a release PR");
ok(!isReleasePr({ head: { ref: "next" }, base: { ref: "develop" } }, opts), "next → develop is NOT a release PR");
ok(!isReleasePr({ head: {}, base: {} }, opts), "missing refs → not a release PR");

console.log("\nlatestApprovalPresent — review reduction:");
const AA = { allowedAssociations: new Set(["MEMBER", "OWNER"]) };
ok(latestApprovalPresent([{ user: { login: "a" }, state: "APPROVED", author_association: "OWNER" }], AA), "single owner approval → true");
ok(
	!latestApprovalPresent([{ user: { login: "a" }, state: "APPROVED", author_association: "CONTRIBUTOR" }], AA),
	"approval from a non-allowed association → false"
);
ok(
	latestApprovalPresent(
		[
			{ user: { login: "a" }, state: "CHANGES_REQUESTED", author_association: "OWNER" },
			{ user: { login: "a" }, state: "APPROVED", author_association: "OWNER" }
		],
		AA
	),
	"later approval supersedes the same user's earlier change-request → true"
);
ok(
	!latestApprovalPresent(
		[
			{ user: { login: "a" }, state: "APPROVED", author_association: "OWNER" },
			{ user: { login: "b" }, state: "CHANGES_REQUESTED", author_association: "MEMBER" }
		],
		AA
	),
	"an outstanding change-request from another reviewer blocks → false"
);
ok(
	latestApprovalPresent(
		[
			{ user: { login: "a" }, state: "APPROVED", author_association: "OWNER" },
			{ user: { login: "a" }, state: "COMMENTED", author_association: "OWNER" }
		],
		AA
	),
	"a later COMMENTED does not un-approve → true"
);
ok(!latestApprovalPresent([], AA), "no reviews → false");
ok(
	latestApprovalPresent([{ user: { login: "a" }, state: "APPROVED", author_association: "CONTRIBUTOR" }], {
		allowedAssociations: new Set(),
		requireAssociation: false
	}),
	"requireAssociation:false accepts any approver → true"
);

console.log("\nevaluateChecks — full-check-set gate:");
const passOne = [{ name: "CI", status: "completed", conclusion: "success" }];
eq(evaluateChecks(passOne, [], {}).state, "passed", "single passing check → passed");
eq(evaluateChecks([{ name: "CI", status: "in_progress", conclusion: null }], [], {}).state, "pending", "an in-progress check → pending");
eq(
	evaluateChecks(
		[
			{ name: "CI", status: "completed", conclusion: "success" },
			{ name: "Coverage", status: "queued", conclusion: null }
		],
		[],
		{}
	).state,
	"pending",
	"a queued non-required check keeps it pending (waits for ALL, not just required)"
);
eq(
	evaluateChecks(
		[
			{ name: "CI", status: "completed", conclusion: "success" },
			{ name: "Docs", status: "completed", conclusion: "failure" }
		],
		[],
		{}
	).state,
	"failed",
	"any failing check → failed"
);
eq(
	evaluateChecks([{ name: "Flaky", status: "completed", conclusion: "failure" }], [], { allowFailing: new Set(["Flaky"]) }).state,
	"passed",
	"an allow-listed failing check does not block"
);
eq(
	evaluateChecks(
		[
			{ name: "Skipped job", status: "completed", conclusion: "skipped" },
			{ name: "Neutral job", status: "completed", conclusion: "neutral" }
		],
		[],
		{}
	).state,
	"passed",
	"skipped/neutral conclusions pass"
);
{
	// The merge workflow's own in-progress run must be excluded, or it deadlocks.
	const withSelf = [
		{ name: "CI", status: "completed", conclusion: "success" },
		{ name: "🚦 Release Merge", status: "in_progress", conclusion: null }
	];
	eq(evaluateChecks(withSelf, [], { selfPattern: "Release Merge" }).state, "passed", "self check-run is excluded from the gate");
	eq(evaluateChecks(withSelf, [], {}).state, "pending", "without self-exclusion it would (wrongly) wait on itself");
}
eq(
	evaluateChecks(passOne, [{ context: "legacy/status", state: "pending" }], {}).state,
	"pending",
	"a pending legacy commit status also gates"
);
eq(evaluateChecks(passOne, [{ context: "legacy/status", state: "failure" }], {}).state, "failed", "a failing legacy commit status blocks");
eq(evaluateChecks([], [], {}).state, "passed", "no checks at all → passed (empty legacy statuses ignored)");

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
