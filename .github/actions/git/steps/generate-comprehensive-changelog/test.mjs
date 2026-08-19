#!/usr/bin/env node
/**
 * @fileoverview Unit tests for readVersionChangelogFile — the committed-changelog
 * lookup that sources the release-PR body. Covers in-workspace discovery (nested
 * + flat layouts), the default search of both `docs/changelog` and the plural
 * `docs/changelogs`, exact-version matching (a patch never falls back to a
 * different version's file), the empty-file fallback to the generated changelog,
 * and the path confinement that keeps caller-controlled CHANGELOG_DIR/CHANGELOG_FILE
 * inputs from escaping GITHUB_WORKSPACE. Run: `node test.mjs`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readVersionChangelogFile } from "./action.mjs";

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
	if (cond) {
		console.log(`  ✅ ${label}`);
	} else {
		console.error(`  ❌ ${label}`);
		failures++;
	}
}

// Build a throwaway workspace with changelog fixtures, plus a secret file that
// lives OUTSIDE the workspace root so traversal attempts have something real to
// (fail to) reach.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-test-"));
const ws = path.join(scratch, "ws");
fs.mkdirSync(path.join(ws, "docs/changelog/v9"), { recursive: true });
fs.writeFileSync(path.join(ws, "docs/changelog/v9/v9.9.9.md"), "# Notes 9.9.9\n\nnested layout\n");
fs.writeFileSync(path.join(ws, "docs/changelog/v8.0.0.md"), "# Notes 8.0.0\n\nflat layout\n");
fs.writeFileSync(path.join(ws, "docs/changelog/v7.0.0.md"), "   \n\n"); // whitespace-only → treated as empty
// Plural spelling (docs/changelogs) — this repo's convention; must be found by
// default. v5.7.0 also seeds the exact-version test (5.7.8 must NOT use it).
fs.mkdirSync(path.join(ws, "docs/changelogs"), { recursive: true });
fs.writeFileSync(path.join(ws, "docs/changelogs/v4.20.0.md"), "# Notes 4.20.0\n\nplural dir\n");
fs.writeFileSync(path.join(ws, "docs/changelogs/v5.7.0.md"), "# Notes 5.7.0\n\nminor rollup\n");
fs.writeFileSync(path.join(scratch, "SECRET.txt"), "TOP-SECRET\n"); // one level above the workspace root

process.env.GITHUB_WORKSPACE = ws;
const D = "docs/changelog";

console.log("readVersionChangelogFile — in-workspace discovery:");
eq(readVersionChangelogFile("9.9.9", D, ""), "# Notes 9.9.9\n\nnested layout", "nested v<major>/v<version>.md");
eq(readVersionChangelogFile("v8.0.0", D, ""), "# Notes 8.0.0\n\nflat layout", "flat v<version>.md (leading v stripped)");
eq(readVersionChangelogFile("6.6.6", D, ""), null, "no matching file → null (falls back to generated changelog)");
eq(readVersionChangelogFile("7.0.0", D, ""), null, "empty/whitespace-only file → null (falls back)");

console.log("\nreadVersionChangelogFile — default dirs (singular + plural) when dir is unset:");
eq(readVersionChangelogFile("9.9.9", "", ""), "# Notes 9.9.9\n\nnested layout", "unset dir finds singular docs/changelog (nested)");
eq(readVersionChangelogFile("8.0.0", "", ""), "# Notes 8.0.0\n\nflat layout", "unset dir finds singular docs/changelog (flat)");
eq(readVersionChangelogFile("4.20.0", "", ""), "# Notes 4.20.0\n\nplural dir", "unset dir finds plural docs/changelogs");
// Explicit dir searches ONLY that dir — the plural-only file is not found when
// the caller pins the singular dir.
eq(
	readVersionChangelogFile("4.20.0", "docs/changelog", ""),
	null,
	"explicit dir searches only that dir (plural file not found under singular)"
);

console.log("\nreadVersionChangelogFile — EXACT version only (never a different version's file):");
eq(readVersionChangelogFile("5.7.0", "", ""), "# Notes 5.7.0\n\nminor rollup", "exact v5.7.0 resolves to its own file");
eq(readVersionChangelogFile("5.7.8", "", ""), null, "patch 5.7.8 does NOT fall back to v5.7.0.md → null (generated changelog used)");

console.log("\nreadVersionChangelogFile — explicit file template:");
eq(
	readVersionChangelogFile("9.9.9", D, "docs/changelog/v{major}/v{version}.md"),
	"# Notes 9.9.9\n\nnested layout",
	"{version}/{major} placeholders resolve"
);

console.log("\nreadVersionChangelogFile — path confinement (never escapes GITHUB_WORKSPACE):");
const escFile = readVersionChangelogFile("5.5.5", D, "../SECRET.txt");
ok(escFile === null, "../ file template rejected → null");
ok(!(escFile || "").includes("TOP-SECRET"), "no secret content leaked via ../ file template");
eq(readVersionChangelogFile("5.5.5", D, "/etc/hostname"), null, "absolute file template rejected");
eq(readVersionChangelogFile("5.5.5", "../..", ""), null, "../ dir input rejected");
// An in-workspace file whose real target is OUTSIDE the workspace (symlink):
// abs passes the prefix check, but the resolved real path must be re-confined.
fs.symlinkSync(path.join(scratch, "SECRET.txt"), path.join(ws, "docs/changelog/v4.4.4.md"));
const linked = readVersionChangelogFile("4.4.4", D, "");
ok(linked === null, "in-workspace symlink whose target escapes the workspace → null");
ok(!(linked || "").includes("TOP-SECRET"), "no secret leaked via escaping symlink");

console.log("\nreadVersionChangelogFile — log sanitization (no CR/LF / workflow-command injection):");
{
	const captured = [];
	const origLog = console.log;
	console.log = (...args) => captured.push(args.join(" "));
	// A caller-influenced value carrying a newline + a GitHub Actions workflow
	// command; the rejection path logs it, so it must be collapsed to one line.
	readVersionChangelogFile("5.5.5", D, "../evil\n::set-output name=x::y");
	console.log = origLog;
	ok(!captured.some((line) => /[\r\n]/.test(line)), "no raw CR/LF survives into a logged value");
	ok(
		!captured
			.join("\n")
			.split("\n")
			.some((line) => line.startsWith("::")),
		"no logged line starts with :: (workflow-command injection blocked)"
	);
}

fs.rmSync(scratch, { recursive: true, force: true });

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
