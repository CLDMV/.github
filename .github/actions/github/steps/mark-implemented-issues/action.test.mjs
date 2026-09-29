#!/usr/bin/env node
/**
 * @fileoverview Unit tests for mark-implemented-issues pure helpers — range
 * exclusion, source-PR extraction, merged-PR selection, the status-label plan,
 * and the issue comment. Run: `node action.test.mjs`.
 */

import { unreleasedInPush, sourcePRsFromCommits, pickMergedInto, planLabelChange, implementedComment } from "./action.mjs";

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

const commit = (sha, message) => ({ sha, commit: { message } });

console.log("unreleasedInPush:");
eq(
	unreleasedInPush([commit("a", "x"), commit("b", "y"), commit("c", "z")], [commit("b", "y"), commit("c", "z"), commit("m", "sync")]).map(
		(c) => c.sha
	),
	["b", "c"],
	"keeps only unreleased commits this push introduced"
);
eq(
	unreleasedInPush([commit("a", "x")], [commit("r", "release squash")]).map((c) => c.sha),
	[],
	"master→next sync of released work → nothing"
);
eq(unreleasedInPush(null, null), [], "null inputs");

console.log("\nsourcePRsFromCommits:");
eq(
	sourcePRsFromCommits([
		commit("a", "feat: add widgets (#12)\n\nResolves #496"),
		commit("b", "fix: typo\n\nsee (#99) in body"),
		commit("c", "chore: sync (#12)")
	]),
	[12],
	"subject refs only, deduped"
);
eq(sourcePRsFromCommits([commit("a", "chore: bump version to 4.30.0")]), [], "no refs");

console.log("\npickMergedInto:");
const prs = [
	{ number: 5, merged_at: null, base: { ref: "master" } },
	{ number: 7, merged_at: "2026-09-28T01:00:00Z", base: { ref: "next" } },
	{ number: 9, merged_at: "2026-09-28T02:00:00Z", base: { ref: "hotfixes" } }
];
eq(pickMergedInto(prs, "next"), 7, "merged into next, ignores the open release PR");
eq(pickMergedInto(prs, "hotfixes"), 9, "merged into hotfixes");
eq(pickMergedInto([{ number: 5, merged_at: null, base: { ref: "master" } }], "next"), null, "only the release PR → null");
eq(pickMergedInto(null, "next"), null, "null list");

console.log("\nplanLabelChange:");
const L = (...names) => names.map((name) => ({ name }));
eq(planLabelChange(L("type: bug"), "status: implemented"), { skip: false, remove: [] }, "no status label");
eq(
	planLabelChange(L("type: bug", "status: in progress"), "status: implemented"),
	{ skip: false, remove: ["status: in progress"] },
	"replaces in progress"
);
eq(
	planLabelChange(L("status: not started", "status: confirmed", "priority: high"), "status: implemented"),
	{ skip: false, remove: ["status: not started", "status: confirmed"] },
	"removes every other status label"
);
eq(
	planLabelChange(L("status: implemented"), "status: implemented"),
	{ skip: true, reason: 'already labeled "status: implemented"' },
	"idempotent"
);
eq(planLabelChange(L("Status: Implemented"), "status: implemented").skip, true, "case-insensitive match");
eq(planLabelChange(L("status: verified"), "status: implemented").skip, true, "never downgrades verified");
eq(planLabelChange(["status: in progress"], "status: implemented"), { skip: false, remove: ["status: in progress"] }, "string labels");
eq(planLabelChange(null, "status: implemented"), { skip: false, remove: [] }, "null labels");

console.log("\nimplementedComment:");
eq(
	implementedComment({ label: "status: implemented", source: 12, branch: "next" }),
	"Marked `status: implemented` — resolved by #12, merged into `next`. This issue closes automatically when that work ships to the default branch.",
	"PR source"
);
eq(
	implementedComment({ label: "status: implemented", source: "abcdef1234567", branch: "hotfixes" }).includes(
		"resolved by `abcdef1`, merged into `hotfixes`"
	),
	true,
	"commit source"
);

if (failures) {
	console.error(`\n❌ ${failures} failure(s)`);
	process.exit(1);
}
console.log("\n✅ all passed");
