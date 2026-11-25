#!/usr/bin/env node
/**
 * @fileoverview Tests for the build-cache key planning: input parsing, glob
 * matching (literal files and directories, `*`, `**`, `{a,b}`, `!` excludes,
 * node_modules/.git skipping), key stability and sensitivity, the save
 * decision per event/ref, and plan.mjs's step outputs (run as a subprocess,
 * the way the composite invokes it).
 * Run via `npm test` from the repo root.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeKey, globToRegExp, literalBase, matchKeyFiles, parseList, plan, shouldSave } from "./build-cache.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

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

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "build-cache-test-"));
function write(rel, content) {
	const abs = path.join(scratch, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content);
}

try {
	write("sqlite.version.json", '{"version":"3.50.0"}');
	write("src/c/glue.c", "int main(){}");
	write("src/c/sub/extra.h", "#define X 1");
	write("src/js/index.mjs", "export {}");
	write("scripts/build-wasm.mjs", "// build");
	write("scripts/notes.md", "notes");
	write("node_modules/dep/index.js", "x");
	write(".git/HEAD", "ref: refs/heads/next");
	write("pkg/a.json", "{}");
	write("pkg/b.yaml", "b: 1");
	write("pkg/c.txt", "c");

	console.log("parseList");
	eq(parseList("  a \n\n# comment\nb\r\n"), ["a", "b"], "trims, drops blanks and # comments");
	eq(parseList(""), [], "empty input");

	console.log("globToRegExp / literalBase");
	eq(globToRegExp("src/**").test("src/c/sub/extra.h"), true, "** spans directories");
	eq(globToRegExp("src/*").test("src/c/glue.c"), false, "* stays within a segment");
	eq(globToRegExp("**/*.c").test("glue.c"), true, "**/ matches zero directories");
	eq(globToRegExp("pkg/*.{json,yaml}").test("pkg/b.yaml"), true, "{a,b} alternation");
	eq(globToRegExp("a.b").test("axb"), false, ". is literal");
	eq(literalBase("src/c/**"), "src/c", "base of a directory glob");
	eq(literalBase("**/*.c"), "", "base of a root glob");

	console.log("matchKeyFiles");
	eq(matchKeyFiles(scratch, ["sqlite.version.json"]), ["sqlite.version.json"], "literal file");
	eq(matchKeyFiles(scratch, ["src/c"]), ["src/c/glue.c", "src/c/sub/extra.h"], "literal directory covers its files");
	eq(matchKeyFiles(scratch, ["src/c/**"]), ["src/c/glue.c", "src/c/sub/extra.h"], "directory glob");
	eq(matchKeyFiles(scratch, ["scripts/*.mjs"]), ["scripts/build-wasm.mjs"], "extension glob");
	eq(matchKeyFiles(scratch, ["pkg/*.{json,yaml}"]), ["pkg/a.json", "pkg/b.yaml"], "brace glob");
	eq(matchKeyFiles(scratch, ["src/**", "!src/c/sub/**"]), ["src/c/glue.c", "src/js/index.mjs"], "! excludes");
	eq(matchKeyFiles(scratch, ["**/*.js", "**/HEAD"]), [], "node_modules and .git are not walked by a root glob");
	eq(matchKeyFiles(scratch, ["node_modules/dep/**"]), ["node_modules/dep/index.js"], "node_modules when named");
	eq(matchKeyFiles(scratch, ["missing/file.txt", "missing/**"]), [], "missing paths match nothing");
	eq(matchKeyFiles(scratch, ["./src/c/", "src/c/glue.c"]), ["src/c/glue.c", "src/c/sub/extra.h"], "./ and trailing / normalized, deduped");

	console.log("computeKey");
	const base = { os: "Linux", arch: "X64", buildCommand: "npm run build", paths: [".cache/build"], files: [["a", "1"]] };
	const key = computeKey(base);
	eq(/^linux-x64-cldmv-build-[0-9a-f]{64}$/.test(key), true, "layout <os>-<arch>-cldmv-build-<sha256>");
	eq(computeKey({ ...base }), key, "stable for the same inputs");
	eq(computeKey({ ...base, buildCommand: "npm run build:ci" }) !== key, true, "changes with the build command");
	eq(computeKey({ ...base, paths: [".cache/other"] }) !== key, true, "changes with the cached paths");
	eq(computeKey({ ...base, files: [["a", "2"]] }) !== key, true, "changes with a file's content");
	eq(computeKey({ ...base, files: [["b", "1"]] }) !== key, true, "changes with a file's path");
	eq(computeKey({ ...base, os: "macOS" }) !== key, true, "changes with the OS");

	console.log("shouldSave");
	eq(shouldSave({ eventName: "push", ref: "refs/heads/master", defaultBranch: "master" }), true, "push to default branch");
	eq(shouldSave({ eventName: "push", ref: "refs/heads/main", defaultBranch: "main" }), true, "push to main as default");
	eq(shouldSave({ eventName: "push", ref: "refs/heads/next", defaultBranch: "master" }), true, "push to next");
	eq(shouldSave({ eventName: "push", ref: "refs/heads/hotfixes", defaultBranch: "master" }), true, "push to hotfixes");
	eq(shouldSave({ eventName: "push", ref: "refs/heads/feat/x", defaultBranch: "master" }), false, "push to a feature branch");
	eq(shouldSave({ eventName: "pull_request", ref: "refs/pull/1/merge", defaultBranch: "master" }), false, "pull_request");
	eq(shouldSave({ eventName: "push", ref: "refs/tags/v1.0.0", defaultBranch: "master" }), false, "tag push");
	eq(shouldSave({ eventName: "workflow_dispatch", ref: "refs/heads/master", defaultBranch: "master" }), false, "dispatch");

	console.log("plan");
	const ctx = {
		root: scratch,
		buildCommand: "npm run build",
		os: "Linux",
		arch: "X64",
		eventName: "push",
		ref: "refs/heads/next",
		defaultBranch: "master"
	};
	eq(plan({ ...ctx, paths: "", keyFiles: "src/**" }).enabled, false, "no paths = off");
	const p1 = plan({ ...ctx, paths: ".cache/toolchains\n.cache/build", keyFiles: "sqlite.version.json\nsrc/c/**\nscripts/build-wasm.mjs" });
	eq(p1.enabled, true, "paths = on");
	eq(p1.save, true, "save on push to next");
	eq(p1.files, ["scripts/build-wasm.mjs", "sqlite.version.json", "src/c/glue.c", "src/c/sub/extra.h"], "key files listed");
	write("src/js/index.mjs", "export const x = 1;");
	eq(
		plan({ ...ctx, paths: ".cache/toolchains\n.cache/build", keyFiles: "sqlite.version.json\nsrc/c/**\nscripts/build-wasm.mjs" }).key,
		p1.key,
		"an unrelated file change keeps the key"
	);
	write("src/c/glue.c", "int main(){return 0;}");
	eq(
		plan({ ...ctx, paths: ".cache/toolchains\n.cache/build", keyFiles: "sqlite.version.json\nsrc/c/**\nscripts/build-wasm.mjs" }).key !==
			p1.key,
		true,
		"a key file change changes the key"
	);

	console.log("plan.mjs outputs");
	function runPlan(env) {
		const outFile = path.join(scratch, `out-${Math.random().toString(36).slice(2)}.txt`);
		fs.writeFileSync(outFile, "");
		const eventPath = path.join(scratch, "event.json");
		fs.writeFileSync(eventPath, JSON.stringify({ repository: { default_branch: "master" } }));
		const res = spawnSync(process.execPath, [path.join(here, "plan.mjs")], {
			cwd: scratch,
			encoding: "utf8",
			env: {
				PATH: process.env.PATH,
				GITHUB_OUTPUT: outFile,
				GITHUB_EVENT_PATH: eventPath,
				RUNNER_OS: "Linux",
				RUNNER_ARCH: "X64",
				BUILD_COMMAND: "npm run build",
				...env
			}
		});
		const outputs = {};
		for (const line of fs.readFileSync(outFile, "utf8").split("\n")) {
			const idx = line.indexOf("=");
			if (idx > 0) outputs[line.slice(0, idx)] = line.slice(idx + 1);
		}
		return { status: res.status, stdout: res.stdout, outputs };
	}
	const off = runPlan({ BUILD_CACHE_PATHS: "", GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/master" });
	eq([off.status, off.outputs.enabled, off.outputs.key, off.outputs["save-eligible"]], [0, "false", "", "false"], "off: enabled=false");
	const onMaster = runPlan({
		BUILD_CACHE_PATHS: ".cache/build",
		BUILD_CACHE_KEY_FILES: "src/c/**",
		GITHUB_EVENT_NAME: "push",
		GITHUB_REF: "refs/heads/master"
	});
	eq(
		[onMaster.status, onMaster.outputs.enabled, onMaster.outputs["save-eligible"]],
		[0, "true", "true"],
		"push to master (default from event payload): save-eligible"
	);
	eq(/^linux-x64-cldmv-build-[0-9a-f]{64}$/.test(onMaster.outputs.key), true, "key output");
	const onPr = runPlan({
		BUILD_CACHE_PATHS: ".cache/build",
		BUILD_CACHE_KEY_FILES: "src/c/**",
		GITHUB_EVENT_NAME: "pull_request",
		GITHUB_REF: "refs/pull/3/merge"
	});
	eq(
		[onPr.outputs.enabled, onPr.outputs["save-eligible"], onPr.outputs.key],
		["true", "false", onMaster.outputs.key],
		"pull_request: same key, restore only"
	);
	const noFiles = runPlan({
		BUILD_CACHE_PATHS: ".cache/build",
		BUILD_CACHE_KEY_FILES: "nope/**",
		GITHUB_EVENT_NAME: "push",
		GITHUB_REF: "refs/heads/next"
	});
	eq(noFiles.stdout.includes("::warning title=Build cache::No files matched"), true, "warns when no key files match");
} finally {
	fs.rmSync(scratch, { recursive: true, force: true });
}

if (failures > 0) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log("\nAll build-cache tests passed.");
