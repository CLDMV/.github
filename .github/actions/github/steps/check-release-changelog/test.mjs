#!/usr/bin/env node
/**
 * @fileoverview Unit tests for check-release-changelog: title/version parsing,
 * expected-path resolution, parity with readVersionChangelogFile, the README
 * What's New advisory, and the skip-variable parse. No network.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { versionFromTitle, expectedChangelogPaths, whatsNewStatus, isSkipped } from "./action.mjs";
import { readVersionChangelogFile } from "../../../git/steps/generate-comprehensive-changelog/action.mjs";

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

console.log("versionFromTitle:");
eq(versionFromTitle("release: v4.31.1 - fix things"), "4.31.1", "title with suffix");
eq(versionFromTitle("release: v1.0.0"), "1.0.0", "bare title");
eq(versionFromTitle("release: v2.0.0-rc.1 - x"), "2.0.0-rc.1", "prerelease");
eq(versionFromTitle("feat: something"), "", "non-release title");
eq(versionFromTitle(""), "", "empty");

console.log("\nexpectedChangelogPaths:");
eq(expectedChangelogPaths("4.31.1", "", "").preferred, "docs/changelog/v4/v4.31.1.md", "default preferred is nested-by-major");
eq(expectedChangelogPaths("4.31.1", "", "").candidates.length, 6, "default searches both dirs x 3 layouts");
eq(
	expectedChangelogPaths("4.31.1", "notes/", "").candidates,
	["notes/v4/v4.31.1.md", "notes/v4.31.1.md", "notes/4.31.1.md"],
	"explicit dir only"
);
eq(expectedChangelogPaths("4.31.1", "", "rel/{major}/{version}.md").preferred, "rel/4/4.31.1.md", "template wins");

console.log("\nparity with readVersionChangelogFile:");
const ws = fs.mkdtempSync(path.join(os.tmpdir(), "relcl-test-"));
process.env.GITHUB_WORKSPACE = ws;
try {
	for (const rel of ["docs/changelog/v9/v9.9.9.md", "docs/changelogs/v8.0.0.md", "docs/changelog/7.0.0.md"]) {
		fs.mkdirSync(path.join(ws, path.dirname(rel)), { recursive: true });
		fs.writeFileSync(path.join(ws, rel), "# notes\n");
	}
	for (const v of ["9.9.9", "8.0.0", "7.0.0"]) {
		const { candidates } = expectedChangelogPaths(v, "", "");
		eq(
			candidates.some((c) => fs.existsSync(path.join(ws, c))) && readVersionChangelogFile(v, "", "") !== null,
			true,
			`${v}: a listed candidate is what the generator reads`
		);
	}
	eq(readVersionChangelogFile("1.2.3", "", ""), null, "absent version → null");
} finally {
	fs.rmSync(ws, { recursive: true, force: true });
}

console.log("\nwhatsNewStatus:");
const readme = "# Pkg\n\n## ✨ What's New\n\n### Latest: v4.31.1\n\n- thing\n\n### Recent\n\n- v4.31.0\n\n## Install\n\nv9.9.9 here\n";
eq(whatsNewStatus(readme, "4.31.1"), "named", "version named in block");
eq(whatsNewStatus(readme, "4.31.2"), "missing", "version absent from block");
eq(whatsNewStatus(readme, "9.9.9"), "missing", "mention outside the block does not count");
eq(whatsNewStatus(readme, "4.31"), "missing", "prefix of another version does not count");
eq(whatsNewStatus("# Pkg\n\nnothing\n", "1.0.0"), "no-section", "no What's New section");

console.log("\nisSkipped:");
eq(
	[isSkipped("1"), isSkipped("true"), isSkipped(" TRUE "), isSkipped("0"), isSkipped(""), isSkipped(undefined)],
	[true, true, true, false, false, false],
	"only 1/true enable"
);

if (failures > 0) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log("\nAll tests passed");
