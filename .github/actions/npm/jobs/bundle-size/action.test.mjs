#!/usr/bin/env node
/**
 * @fileoverview Tests for the bundle-size action's measure mode: which files a
 * `dist_paths` value selects (exact file paths, top-level globs, `**` trees) and
 * the zero-match `::warning::`. Each case runs action.mjs as a subprocess against
 * a throwaway fixture tree, exactly as the Actions runner invokes it.
 * Run via `npm test` from the repo root.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const actionPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "action.mjs");

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

// Fixture tree, shaped like a source-shipped package with a CLI and a lib/.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-size-test-"));
const files = {
	"index.mjs": "export const a = 1;\n",
	"index.cjs": "module.exports = { a: 1 };\n",
	"README.md": "# fixture\n",
	"src/b.mjs": "export const b = 2;\n",
	"src/sub/c.mjs": "export const c = 3;\n",
	"bin/cli.mjs": "#!/usr/bin/env node\n",
	"lib/util.mjs": "export const util = 4;\n",
	"lib/deep/more.mjs": "export const more = 5;\n"
};
for (const [rel, content] of Object.entries(files)) {
	const abs = path.join(fixture, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content);
}

/**
 * Run measure mode against the fixture.
 * @param {string} distPaths - The `dist_paths` input.
 * @returns {{ status: number|null, stdout: string, paths: string[], summary: string }}
 */
function measure(distPaths) {
	const outFile = path.join(fixture, ".out-sizes.json");
	const summaryFile = path.join(fixture, ".out-summary.md");
	fs.rmSync(outFile, { force: true });
	fs.rmSync(summaryFile, { force: true });
	const run = spawnSync(process.execPath, [actionPath], {
		cwd: fixture,
		encoding: "utf8",
		env: {
			...process.env,
			INPUT_MODE: "measure",
			INPUT_DIST_PATHS: distPaths,
			INPUT_OUTPUT_FILE: outFile,
			GITHUB_STEP_SUMMARY: summaryFile
		}
	});
	const paths = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")).files.map((f) => f.path) : [];
	const summary = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, "utf8") : "";
	return { status: run.status, stdout: run.stdout, paths, summary };
}

const hasWarning = (r) => r.stdout.split("\n").some((l) => l.startsWith("::warning"));

try {
	console.log("measure — exact file paths match:");
	let r = measure("index.mjs");
	eq(r.paths, ["index.mjs"], "top-level file `index.mjs` is measured");
	eq(hasWarning(r), false, "no zero-match warning when a file matched");

	r = measure("lib/util.mjs");
	eq(r.paths, ["lib/util.mjs"], "nested exact path `lib/util.mjs` is measured (and nothing else under lib/)");

	r = measure("index.mjs,src/**");
	eq(r.paths, ["index.mjs", "src/b.mjs", "src/sub/c.mjs"], "source-shipped `index.mjs,src/**`");

	r = measure("index.mjs, index.cjs");
	eq(r.paths, ["index.cjs", "index.mjs"], "several plain files, whitespace around commas trimmed");

	console.log("measure — globs:");
	r = measure("bin/**,lib/**");
	eq(r.paths, ["bin/cli.mjs", "lib/deep/more.mjs", "lib/util.mjs"], "`bin/**,lib/**` walks both trees at any depth");

	r = measure("*.mjs");
	eq(r.paths, ["index.mjs"], "top-level `*.mjs` matches only root-level files (`*` stays within one segment)");

	r = measure("*index.mjs");
	eq(r.paths, ["index.mjs"], "the older `*index.mjs` workaround still matches");

	r = measure("src/*.mjs");
	eq(r.paths, ["src/b.mjs"], "`src/*.mjs` does not descend into src/sub/");

	console.log("measure — zero matches warn but pass:");
	r = measure("dist/**");
	eq(r.status, 0, "missing dist/ exits 0");
	eq(r.paths, [], "missing dist/ measures nothing");
	eq(hasWarning(r), true, "missing dist/ emits a ::warning:: line");
	eq(r.summary.includes("dist_paths matched 0 files (dist/**)"), true, "warning is also written to the step summary");

	r = measure("nope.mjs");
	eq(r.status, 0, "missing exact file exits 0");
	eq(hasWarning(r), true, "missing exact file emits a ::warning:: line");

	r = measure("index.mjs");
	eq(r.status, 0, "a matching run exits 0");

	console.log("measure — `./`-prefixed patterns (#327):");
	r = measure("./index.mjs");
	eq(r.paths, ["index.mjs"], "`./index.mjs` is measured and recorded as `index.mjs`");

	r = measure("./src/**");
	eq(r.paths, ["src/b.mjs", "src/sub/c.mjs"], "`./src/**` walks src/ at any depth");

	r = measure("./lib/util.mjs, ./bin/**");
	eq(r.paths, ["bin/cli.mjs", "lib/util.mjs"], "mixed `./` exact path and glob");

	console.log("measure — wildcard mid-segment (#327):");
	r = measure("lib/ut*.mjs");
	eq(r.paths, ["lib/util.mjs"], "`lib/ut*.mjs` walks lib/, not a nonexistent `lib/ut`");

	console.log("measure — overlapping patterns count a file once:");
	r = measure("index.mjs,*.mjs");
	eq(r.paths, ["index.mjs"], "`index.mjs,*.mjs` measures index.mjs once, not once per matching root");

	console.log("measure — the walk skips node_modules/.git and unreachable dirs (#327):");
	for (const rel of ["node_modules/pkg/index.mjs", ".git/hooks/pre-commit.mjs", "src/node_modules/dep/x.mjs"]) {
		const abs = path.join(fixture, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, "export {};\n");
	}
	r = measure("**/*.mjs");
	eq(
		r.paths,
		["bin/cli.mjs", "index.mjs", "lib/deep/more.mjs", "lib/util.mjs", "src/b.mjs", "src/sub/c.mjs"],
		"`**/*.mjs` never includes files under node_modules/ or .git/"
	);

	// A directory the walk can't read makes readdirSync throw — so a pattern that
	// can't reach it must not descend into it. (Skipped as root: root reads anything.)
	if (typeof process.getuid !== "function" || process.getuid() !== 0) {
		const locked = path.join(fixture, "locked");
		fs.mkdirSync(locked);
		fs.writeFileSync(path.join(locked, "x.mjs"), "export {};\n");
		fs.chmodSync(locked, 0o000);
		try {
			r = measure("*.mjs");
			eq(r.status, 0, "top-level `*.mjs` doesn't descend into an unreachable (unreadable) subdirectory");
			eq(r.paths, ["index.mjs"], "top-level `*.mjs` still measures the root-level file");
			r = measure("src/**");
			eq(r.status, 0, "`src/**` doesn't descend into a sibling directory");
		} finally {
			fs.chmodSync(locked, 0o755);
		}
	}
} finally {
	fs.rmSync(fixture, { recursive: true, force: true });
}

if (failures) {
	console.error(`\n${failures} test(s) failed.`);
	process.exit(1);
}
console.log("\nAll tests passed.");
