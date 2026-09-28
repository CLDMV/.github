#!/usr/bin/env node
/**
 * @fileoverview Unit tests for the stale-sweep classifier and its default
 * exemption lists. Run directly: `node test.mjs` in this directory. Exits
 * non-zero on failure.
 * @module @cldmv/.github.github.jobs.stale-sweep.test
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Action, classify, buildConfig } from "./classifier.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../..");

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

/** Read an input's `default:` from a flow-style `name: { ..., default: "x" }` line. */
function flowDefault(file, input) {
	const text = fs.readFileSync(path.join(repoRoot, file), "utf8");
	const m = text.match(new RegExp(`^\\s*${input}:\\s*\\{[^}]*default:\\s*"([^"]*)"`, "m"));
	return m ? m[1] : null;
}

// Config built from the action's real defaults, so the tests exercise what a
// caller that overrides nothing actually gets.
const actionYml = ".github/actions/github/jobs/stale-sweep/action.yml";
const defaults = {
	exempt_issue_labels: flowDefault(actionYml, "exempt_issue_labels"),
	exempt_pr_labels: flowDefault(actionYml, "exempt_pr_labels")
};
const config = buildConfig((name) => defaults[name] ?? "");

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-09-28T00:00:00Z");
const issue = (labels, extra = {}) => ({ number: 1, labels: labels.map((name) => ({ name })), assignees: [], milestone: null, ...extra });
const run = (item, { isPR = false, staleDaysAgo = null, inactiveDays = 400 } = {}) =>
	classify({
		item,
		isPR,
		config,
		staleAddedAtMs: staleDaysAgo == null ? null : now - staleDaysAgo * DAY,
		lastActivityMs: now - inactiveDays * DAY,
		nowMs: now
	});

console.log("classify — baseline (no exemption):");
eq(run(issue([])).action, Action.MARK_STALE, "inactive issue is marked stale");
eq(run(issue(["stale"]), { staleDaysAgo: 20 }).action, Action.CLOSE, "stale issue past the grace period is closed");

console.log("classify — `pinned` exempts:");
eq(run(issue(["pinned"])).action, Action.SKIP, "inactive pinned issue is skipped, not marked stale");
eq(run(issue(["Pinned"])).action, Action.SKIP, "label match is case-insensitive");
eq(run(issue(["pinned"]), { isPR: true }).action, Action.SKIP, "inactive pinned PR is skipped");
const pinnedStale = run(issue(["pinned", "stale"]), { staleDaysAgo: 20 });
eq(pinnedStale.action, Action.UNSTALE, "pinned issue already marked stale is un-staled, not closed");
eq(pinnedStale.reason.includes("exempt label: pinned"), true, "un-stale reason names the exemption");

console.log("classify — other exemptions also clear an existing stale label:");
eq(
	run(issue(["stale"], { assignees: [{ login: "someone" }] }), { staleDaysAgo: 20 }).action,
	Action.UNSTALE,
	"assigned + stale → un-stale"
);
eq(run(issue(["stale"], { milestone: { title: "v5" } }), { staleDaysAgo: 20 }).action, Action.UNSTALE, "milestoned + stale → un-stale");
eq(run(issue(["status: blocked"])).action, Action.SKIP, "`status: blocked` (the real org label) exempts");
eq(run(issue(["help wanted"])).action, Action.SKIP, "`help wanted` (the real org label) exempts");
eq(run(issue(["good first issue"])).action, Action.SKIP, "`good first issue` (the real org label) exempts");
eq(run(issue(["type: dependencies"]), { isPR: true }).action, Action.SKIP, "`type: dependencies` PR exempts");

console.log("defaults — match the org label set and stay in sync:");
const orgLabels = new Set(
	JSON.parse(fs.readFileSync(path.join(repoRoot, "data/github-labels.json"), "utf8")).map((l) => l.name.toLowerCase())
);
for (const name of ["pinned", "help wanted", "good first issue", "status: blocked"]) {
	eq(config.exemptIssueLabels.includes(name), true, `issue default exempts \`${name}\``);
	eq(orgLabels.has(name), true, `\`${name}\` exists in data/github-labels.json`);
}
for (const name of ["pinned", "status: blocked", "type: dependencies"]) {
	eq(config.exemptPrLabels.includes(name), true, `PR default exempts \`${name}\``);
	eq(orgLabels.has(name), true, `\`${name}\` exists in data/github-labels.json`);
}
// Label sync maps names AND aliases to canonical labels, later entries winning —
// so a name that is also another label's alias gets renamed away (`pinned` used
// to be a `semver: explicit` alias). No name/alias may collide.
const owners = new Map();
for (const label of JSON.parse(fs.readFileSync(path.join(repoRoot, "data/github-labels.json"), "utf8"))) {
	for (const key of [label.name, ...(label.aliases ?? [])].map((k) => k.toLowerCase())) {
		if (!owners.has(key)) owners.set(key, new Set());
		owners.get(key).add(label.name);
	}
}
const collisions = [...owners].filter(([, names]) => names.size > 1).map(([key, names]) => `${key} → ${[...names].join(" / ")}`);
eq(collisions, [], "no label name or alias maps to two different labels");

for (const input of ["exempt_issue_labels", "exempt_pr_labels"]) {
	eq(flowDefault(".github/workflows/reusable-stale.yml", input), defaults[input], `reusable-stale.yml ${input} default matches action.yml`);
}

if (failures) {
	console.error(`\n${failures} test(s) failed.`);
	process.exit(1);
}
console.log("\nAll tests passed.");
