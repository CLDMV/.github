#!/usr/bin/env node
/**
 * @fileoverview Unit tests for bot-detection pure helpers — focused on the
 * dependency-update exemption that keeps Dependabot/Renovate bumps in the
 * changelog while still dropping the release flow's own bot-trail.
 * Run directly: `node bot-detection.test.mjs` in this directory.
 */

import { isDependencyUpdate, filterBotCommits, isBotAuthor } from "./bot-detection.mjs";

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

console.log("isDependencyUpdate — dependency bumps (kept):");
eq(isDependencyUpdate("deps: bump prettier from 3.8.3 to 3.8.4"), true, "deps: bump … from … to …");
eq(isDependencyUpdate("Build(deps-dev): bump esbuild from 0.28.0 to 0.28.1"), true, "Build(deps-dev): …");
eq(isDependencyUpdate("chore(deps): bump @types/node from 25.9.1 to 25.9.3"), true, "chore(deps): …");
eq(isDependencyUpdate("bump acorn from 8.16.0 to 8.17.0"), true, "bare bump … from … to …");
eq(isDependencyUpdate("Update dependency vite to v6.1.0"), true, "renovate update … to vN");

console.log("isDependencyUpdate — NOT dependency updates (still dropped):");
eq(isDependencyUpdate("chore: bump version to 3.10.1"), false, "release-flow version bump (no 'from')");
eq(isDependencyUpdate("release: v3.10.1 - whatever"), false, "release commit");
eq(isDependencyUpdate("ci(dependabot): use merge commit, not squash, for auto-merge"), false, "dependabot config change (not a bump)");
eq(isDependencyUpdate("feat: add a new thing"), false, "ordinary feature");
eq(isDependencyUpdate(""), false, "empty subject");
eq(isDependencyUpdate(undefined), false, "non-string");

console.log("filterBotCommits — keeps humans + dependency updates, drops the rest:");
const bot = { author: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com" };
const human = { author: "Nate Corcoran", email: "shinrai@users.noreply.github.com" };
const relbot = { author: "cldmv-bot[bot]", email: "cldmv-bot[bot]@users.noreply.github.com" };
const input = [
	{ ...bot, subject: "deps: bump prettier from 3.8.3 to 3.8.4" }, // keep (dep update)
	{ ...bot, subject: "Build(deps-dev): bump esbuild from 0.28.0 to 0.28.1" }, // keep (dep update)
	{ ...relbot, subject: "chore: bump version to 3.10.1" }, // drop (release trail)
	{ ...relbot, subject: "release: v3.10.1 - synthetic leaf" }, // drop (release commit)
	{ ...human, subject: "feat: add a new thing" }, // keep (human)
	{ ...human, subject: "ci(dependabot): use merge commit, not squash" } // keep (human, not a bump)
];
eq(
	filterBotCommits(input).map((c) => c.subject),
	[
		"deps: bump prettier from 3.8.3 to 3.8.4",
		"Build(deps-dev): bump esbuild from 0.28.0 to 0.28.1",
		"feat: add a new thing",
		"ci(dependabot): use merge commit, not squash"
	],
	"keeps the 2 dep bumps + 2 human commits; drops version-bump + release"
);

console.log("sanity — dependabot is still a bot author (loop-guards unaffected):");
eq(isBotAuthor("dependabot[bot]", ""), true, "isBotAuthor unchanged for dependabot");

if (failures) {
	console.error(`\n${failures} test(s) failed.`);
	process.exit(1);
}
console.log("\nAll tests passed.");
