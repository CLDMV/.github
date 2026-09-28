#!/usr/bin/env node
/**
 * @fileoverview Tests for merge-master-into-branch: the Merges API payload and
 * response handling, and the 409 version-only conflict fallback (#334). The
 * fallback cases build real throwaway git repositories modelled on the
 * CLDMV/gh-broker conflict (master hotfix 0.3.3 vs next pending 0.4.0) and
 * publish through a stub api() that replays the Git Data API calls against the
 * same local object store. No network.
 * Run via `npm test` from the repo root.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	analyzeVersionConflict,
	buildFallbackCommitMessage,
	buildMergePayload,
	buildTreeItems,
	diffJsonPaths,
	interpretMergeResponse,
	mergeWithFallback,
	parseDiffTreeRaw,
	parseMergeTreeOutput,
	planLocalMerge,
	publishMergeCommit,
	resolveConflictMarkers
} from "./action.mjs";

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

console.log("buildMergePayload:");
eq(
	buildMergePayload({ targetBranch: "next", sourceRef: "master" }),
	{ base: "next", head: "master", commit_message: "Merge master into next" },
	"default message uses source/target names"
);
eq(
	buildMergePayload({ targetBranch: "next", sourceRef: "master", commitMessage: "" }),
	{ base: "next", head: "master", commit_message: "Merge master into next" },
	"empty message falls back to default"
);
eq(
	buildMergePayload({ targetBranch: "next", sourceRef: "master", commitMessage: "  " }),
	{ base: "next", head: "master", commit_message: "Merge master into next" },
	"whitespace-only message falls back to default"
);
eq(
	buildMergePayload({ targetBranch: "next", sourceRef: "master", commitMessage: "Custom msg" }),
	{ base: "next", head: "master", commit_message: "Custom msg" },
	"custom message used"
);

console.log("\ninterpretMergeResponse:");
eq(
	interpretMergeResponse(201, { sha: "abc123" }),
	{ performed: true, sha: "abc123", conflict: false, error: "" },
	"201 with sha → performed=true"
);
eq(
	interpretMergeResponse(201, {}),
	{ performed: true, sha: "", conflict: false, error: "" },
	"201 without sha → still performed=true, empty sha"
);
eq(interpretMergeResponse(204, null), { performed: false, sha: "", conflict: false, error: "" }, "204 (no content) → already up-to-date");
eq(
	interpretMergeResponse(409, { message: "Merge conflict" }),
	{ performed: false, sha: "", conflict: true, error: "Merge conflict (409) — manual resolution required" },
	"409 → conflict=true, error set"
);
const r404 = interpretMergeResponse(404, { message: "Not Found" });
eq(r404.performed, false, "404 → not performed");
eq(r404.conflict, false, "404 → not a conflict");
eq(r404.error.includes("404"), true, "404 error mentions status");
const r422 = interpretMergeResponse(422, { message: "Validation failed" });
eq(r422.error.includes("422"), true, "422 error mentions status");
const r500 = interpretMergeResponse(500, { message: "boom" });
eq(r500.error.includes("500"), true, "500 error mentions status");

// ---- version-only conflict fallback (#334) --------------------------------

console.log("\nparseMergeTreeOutput:");
{
	const raw =
		"tree111\x00" +
		"100644 aaa 1\tpackage.json\x00100644 bbb 2\tpackage.json\x00100644 ccc 3\tpackage.json\x00" +
		"\x00" +
		"1\x00package.json\x00Auto-merging\x00Auto-merging package.json\n\x00" +
		"1\x00package.json\x00CONFLICT (contents)\x00CONFLICT (content): Merge conflict in package.json\n\x00";
	const parsed = parseMergeTreeOutput(raw);
	eq(parsed.tree, "tree111", "tree OID is the first field");
	eq(
		parsed.entries.map((e) => [e.stage, e.path]),
		[
			[1, "package.json"],
			[2, "package.json"],
			[3, "package.json"]
		],
		"conflicted stages parsed"
	);
	eq(
		parsed.messages.map((m) => m.type),
		["Auto-merging", "CONFLICT (contents)"],
		"message types parsed"
	);
	eq(parseMergeTreeOutput("tree222\x00\x00").entries, [], "clean merge → no conflicted entries");
}

console.log("\nresolveConflictMarkers:");
{
	const text = '{\n<<<<<<< next\n\t"version": "0.4.0",\n=======\n\t"version": "0.3.3",\n>>>>>>> master\n\t"x": 1\n}\n';
	eq(resolveConflictMarkers(text, "ours"), { text: '{\n\t"version": "0.4.0",\n\t"x": 1\n}\n', hunks: 1 }, "ours keeps the target side");
	eq(resolveConflictMarkers(text, "theirs"), { text: '{\n\t"version": "0.3.3",\n\t"x": 1\n}\n', hunks: 1 }, "theirs keeps the source side");
	const diff3 = "a\n<<<<<<< next\nb\n||||||| base\nz\n=======\nc\n>>>>>>> master\n";
	eq(resolveConflictMarkers(diff3, "ours"), { text: "a\nb\n", hunks: 1 }, "diff3 base section is dropped");
	eq(resolveConflictMarkers("a\n<<<<<<< next\nb\n", "ours"), null, "unterminated hunk → null");
	eq(resolveConflictMarkers("a\n>>>>>>> master\n", "ours"), null, "stray closing marker → null");
	eq(resolveConflictMarkers("no markers\n", "ours"), { text: "no markers\n", hunks: 0 }, "no markers → unchanged, 0 hunks");
}

console.log("\ndiffJsonPaths:");
eq(diffJsonPaths({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }), [["b", "c"]], "nested leaf change");
eq(diffJsonPaths({ a: 1 }, { a: 1, d: 2 }), [["d"]], "added key");
eq(diffJsonPaths({ a: [1, 2] }, { a: [1, 2] }), [], "equal arrays");
eq(
	diffJsonPaths({ packages: { "": { version: "1" } } }, { packages: { "": { version: "2" } } }),
	[["packages", "", "version"]],
	"empty-string key path"
);

// Conflicted-file text the way `git merge-tree` writes it.
const conflictJson = (hunks, tail = "") => `{\n${hunks}${tail}}\n`;
const hunk = (ours, theirs) => `<<<<<<< next\n${ours}\n=======\n${theirs}\n>>>>>>> master\n`;

console.log("\nanalyzeVersionConflict:");
{
	const pkg = conflictJson(hunk('\t"version": "0.4.0",', '\t"version": "0.3.3",'), '\t"name": "@cldmv/gh-broker"\n');
	const r = analyzeVersionConflict("package.json", pkg);
	eq(r.ok, true, "package.json root version conflict → safe");
	eq(JSON.parse(r.resolvedText).version, "0.4.0", "package.json resolved to next's version");
	eq(r.fields, [{ path: '"version"', target: "0.4.0", source: "0.3.3" }], "resolved field recorded");

	const lock =
		'{\n\t"name": "@cldmv/gh-broker",\n' +
		hunk('\t"version": "0.4.0",', '\t"version": "0.3.3",') +
		'\t"lockfileVersion": 3,\n\t"packages": {\n\t\t"": {\n\t\t\t"name": "@cldmv/gh-broker",\n' +
		hunk('\t\t\t"version": "0.4.0"', '\t\t\t"version": "0.3.3"') +
		"\t\t}\n\t}\n}\n";
	const rl = analyzeVersionConflict("package-lock.json", lock);
	eq(rl.ok, true, 'package-lock.json root + packages[""] version conflicts → safe');
	eq(rl.fields.length, 2, "both lockfile version fields recorded");
	const lockJson = JSON.parse(rl.resolvedText);
	eq([lockJson.version, lockJson.packages[""].version], ["0.4.0", "0.4.0"], "lockfile resolved to next's version");

	const nested =
		'{\n\t"version": "0.4.0",\n\t"packages": {\n\t\t"node_modules/undici": {\n' +
		hunk('\t\t\t"version": "7.1.0"', '\t\t\t"version": "7.0.1"') +
		"\t\t}\n\t}\n}\n";
	const rn = analyzeVersionConflict("package-lock.json", nested);
	eq(rn.ok, false, 'a nested dependency\'s "version" is NOT a version-only conflict');
	eq(rn.reason.includes("node_modules/undici"), true, "reason names the offending field");

	const desc = conflictJson(hunk('\t"description": "a",', '\t"description": "b",'), '\t"name": "x"\n');
	eq(analyzeVersionConflict("package.json", desc).ok, false, "package.json description conflict → not safe");
	eq(analyzeVersionConflict("README.md", pkg).ok, false, "any other file → not safe");
	eq(analyzeVersionConflict("packages/sub/package.json", pkg).ok, false, "a nested package.json → not safe (root only)");
	eq(analyzeVersionConflict("package.json", "{\n" + hunk('\t"version": 1', "not json") + "}\n").ok, false, "unparseable side → not safe");
}

console.log("\nbuildFallbackCommitMessage:");
eq(
	buildFallbackCommitMessage("Merge master into next", "next", [
		{ path: "package.json", fields: [{ path: '"version"', target: "0.4.0", source: "0.3.3" }] }
	]),
	'Merge master into next\n\nVersion-only conflicts resolved with next\'s side:\n- package.json "version": kept "0.4.0" (source had "0.3.3")',
	"body lists each resolved field"
);
eq(buildFallbackCommitMessage("Merge master into next", "next", []), "Merge master into next", "no resolutions → message unchanged");

console.log("\nbuildTreeItems / parseDiffTreeRaw:");
{
	const Z = "0".repeat(40);
	const raw = `:100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} M\x00package.json\x00:000000 100644 ${Z} ${"c".repeat(40)} A\x00src/fix.mjs\x00:100644 000000 ${"d".repeat(40)} ${Z} D\x00old.txt\x00`;
	const changes = parseDiffTreeRaw(raw);
	eq(
		changes.map((c) => [c.status, c.path]),
		[
			["M", "package.json"],
			["A", "src/fix.mjs"],
			["D", "old.txt"]
		],
		"raw diff-tree parsed"
	);
	eq(
		buildTreeItems(changes, new Set(["c".repeat(40)])),
		[
			{ path: "package.json", mode: "100644", type: "blob", sha: "b".repeat(40), upload: true },
			{ path: "src/fix.mjs", mode: "100644", type: "blob", sha: "c".repeat(40), upload: false },
			{ path: "old.txt", mode: "100644", type: "blob", sha: null, upload: false }
		],
		"new blobs uploaded, known blobs referenced, deletions null"
	);
}

console.log("\nmergeWithFallback:");
{
	let calls = 0;
	const fallbackOk = async () => {
		calls++;
		return { ok: true, sha: "merged1" };
	};
	eq(
		await mergeWithFallback({ merge: async () => ({ status: 201, body: { sha: "abc123" } }), fallback: fallbackOk }),
		{ performed: true, sha: "abc123", conflict: false, error: "", resolved: false },
		"201 → unchanged result"
	);
	eq(
		await mergeWithFallback({ merge: async () => ({ status: 204, body: null }), fallback: fallbackOk }),
		{ performed: false, sha: "", conflict: false, error: "", resolved: false },
		"204 → unchanged result"
	);
	const r404 = await mergeWithFallback({ merge: async () => ({ status: 404, body: { message: "Not Found" } }), fallback: fallbackOk });
	eq(r404.error.includes("404"), true, "404 → still an error");
	eq(calls, 0, "fallback never runs for 201 / 204 / 404");

	eq(
		await mergeWithFallback({ merge: async () => ({ status: 409, body: { message: "Merge conflict" } }), fallback: fallbackOk }),
		{ performed: true, sha: "merged1", conflict: true, resolved: true, error: "" },
		"409 + version-only fallback → merged, resolved"
	);
	eq(calls, 1, "fallback ran once on 409");

	const declined = await mergeWithFallback({
		merge: async () => ({ status: 409, body: null }),
		fallback: async () => ({ ok: false, reason: "README.md: conflict touches non-version field(s)" })
	});
	eq([declined.performed, declined.conflict, declined.resolved], [false, true, false], "409 + declined fallback → not performed");
	eq(declined.error.startsWith("Merge conflict (409) — manual resolution required"), true, "declined → original 409 error kept");
	eq(declined.error.includes("README.md"), true, "declined → fallback reason appended");

	const threw = await mergeWithFallback({
		merge: async () => ({ status: 409, body: null }),
		fallback: async () => {
			throw new Error("fetch failed");
		}
	});
	eq([threw.performed, threw.error.includes("fetch failed")], [false, true], "409 + throwing fallback → error, not a crash");
}

// ---- end-to-end against real git repositories --------------------------------

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "merge-master-test-"));

function git(cwd, args, { input, env } = {}) {
	const r = spawnSync("git", args, { cwd, input, encoding: "utf8", env: { ...process.env, ...env } });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
	return r.stdout.trim();
}

const pkgJson = (version, extra = "") =>
	`{\n\t"name": "@cldmv/gh-broker",\n\t"version": "${version}",\n\t"description": "Credential broker for GitHub MCP",\n\t"type": "module",\n\t"scripts": {\n\t\t"start": "node src/server.mjs",\n\t\t"test": "node tests/run.mjs"${extra}\n\t},\n\t"license": "Apache-2.0"\n}\n`;
const lockJson = (version, undici = "7.0.1") =>
	`{\n\t"name": "@cldmv/gh-broker",\n\t"version": "${version}",\n\t"lockfileVersion": 3,\n\t"requires": true,\n\t"packages": {\n\t\t"": {\n\t\t\t"name": "@cldmv/gh-broker",\n\t\t\t"version": "${version}",\n\t\t\t"license": "Apache-2.0"\n\t\t},\n\t\t"node_modules/undici": {\n\t\t\t"version": "${undici}",\n\t\t\t"license": "MIT"\n\t\t}\n\t}\n}\n`;

/**
 * Build a repo shaped like the gh-broker incident: base 0.3.2; next carries a
 * feature and next-release's 0.4.0 bump; master carries a hotfix and its 0.3.3
 * release bump. `extra` lets a case add more divergent edits per side.
 */
function makeRepo(name, { nextEdit, masterEdit } = {}) {
	const dir = path.join(scratch, name);
	fs.mkdirSync(dir);
	git(dir, ["init", "-q", "-b", "master"]);
	for (const [k, v] of [
		["user.name", "test"],
		["user.email", "test@example.invalid"],
		["commit.gpgsign", "false"],
		["tag.gpgsign", "false"],
		["core.hooksPath", "/dev/null"]
	])
		git(dir, ["config", k, v]);
	const write = (file, text) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	const commit = (msg) => {
		git(dir, ["add", "-A"]);
		git(dir, ["commit", "-q", "-m", msg]);
	};

	write("package.json", pkgJson("0.3.2"));
	write("package-lock.json", lockJson("0.3.2"));
	write("src/server.mjs", "export const timeoutMs = 5000;\n");
	write("README.md", "# gh-broker\n");
	commit("release: v0.3.2");

	git(dir, ["checkout", "-q", "-b", "next"]);
	write("src/feature.mjs", "export const feature = true;\n");
	commit("feat: queued feature");
	nextEdit?.(write);
	write("package.json", fs.readFileSync(path.join(dir, "package.json"), "utf8").replace('"version": "0.3.2"', '"version": "0.4.0"'));
	write(
		"package-lock.json",
		fs.readFileSync(path.join(dir, "package-lock.json"), "utf8").replaceAll('"version": "0.3.2"', '"version": "0.4.0"')
	);
	commit("chore: bump version to 0.4.0");

	git(dir, ["checkout", "-q", "master"]);
	write("src/server.mjs", "export const timeoutMs = 15000;\n");
	masterEdit?.(write);
	write("package.json", fs.readFileSync(path.join(dir, "package.json"), "utf8").replace('"version": "0.3.2"', '"version": "0.3.3"'));
	write(
		"package-lock.json",
		fs.readFileSync(path.join(dir, "package-lock.json"), "utf8").replaceAll('"version": "0.3.2"', '"version": "0.3.3"')
	);
	commit("release: v0.3.3");

	return { dir, targetSha: git(dir, ["rev-parse", "next"]), sourceSha: git(dir, ["rev-parse", "master"]) };
}

/**
 * Stub api(): replays the Git Data API calls against the local repo so the
 * published tree/commit/ref can be inspected with plain git.
 */
function makeStubApi(dir) {
	const calls = [];
	const apiFn = async (method, apiPath, body) => {
		calls.push({ method, path: apiPath, body });
		if (method === "POST" && apiPath === "/git/blobs") {
			return { sha: git(dir, ["hash-object", "-w", "--stdin"], { input: Buffer.from(body.content, "base64").toString("utf8") }) };
		}
		if (method === "POST" && apiPath === "/git/trees") {
			const env = { GIT_INDEX_FILE: path.join(dir, ".git", "stub.index") };
			git(dir, ["read-tree", body.base_tree], { env });
			for (const item of body.tree) {
				if (item.sha === null) git(dir, ["update-index", "--force-remove", item.path], { env });
				else git(dir, ["update-index", "--add", "--cacheinfo", `${item.mode},${item.sha},${item.path}`], { env });
			}
			return { sha: git(dir, ["write-tree"], { env }) };
		}
		if (method === "POST" && apiPath === "/git/commits") {
			const parents = body.parents.flatMap((p) => ["-p", p]);
			return {
				sha: git(dir, ["commit-tree", body.tree, ...parents, "-m", body.message]),
				verification: { verified: true, reason: "valid" }
			};
		}
		if (method === "PATCH" && apiPath.startsWith("/git/refs/heads/")) {
			const branch = apiPath.slice("/git/refs/heads/".length);
			const current = git(dir, ["rev-parse", branch]);
			if (!body.force && spawnSync("git", ["merge-base", "--is-ancestor", current, body.sha], { cwd: dir }).status !== 0) {
				throw new Error(`PATCH ${apiPath} -> 422: Update is not a fast forward`);
			}
			git(dir, ["update-ref", `refs/heads/${branch}`, body.sha]);
			return { object: { sha: body.sha } };
		}
		throw new Error(`unexpected API call ${method} ${apiPath}`);
	};
	return { apiFn, calls };
}

try {
	console.log("\nfallback end-to-end — gh-broker shape (master 0.3.3 hotfix vs next 0.4.0):");
	{
		const { dir, targetSha, sourceSha } = makeRepo("version-only");
		const plan = planLocalMerge({ cwd: dir, targetSha, sourceSha });
		eq(plan.ok, true, "version-only conflict → plan accepted");
		eq(
			plan.resolutions.map((r) => [r.path, r.fields.map((f) => [f.path, f.target, f.source])]),
			[
				[
					"package-lock.json",
					[
						['"version"', "0.4.0", "0.3.3"],
						['"packages".""."version"', "0.4.0", "0.3.3"]
					]
				],
				["package.json", [['"version"', "0.4.0", "0.3.3"]]]
			],
			"all three version lines resolved to next's side"
		);

		const { apiFn, calls } = makeStubApi(dir);
		const sha = await publishMergeCommit({
			cwd: dir,
			targetBranch: "next",
			targetSha,
			sourceSha,
			tree: plan.tree,
			message: "Merge master into next",
			ctx: {},
			apiFn
		});
		eq(git(dir, ["rev-parse", "next"]), sha, "next now points at the merge commit");
		eq(git(dir, ["rev-list", "--parents", "-n", "1", sha]).split(" ").slice(1), [targetSha, sourceSha], "two parents: [next, master]");
		eq(
			spawnSync("git", ["merge-base", "--is-ancestor", sourceSha, "next"], { cwd: dir }).status,
			0,
			"master's release commit is an ancestor of next"
		);
		eq(JSON.parse(git(dir, ["show", "next:package.json"])).version, "0.4.0", "package.json keeps 0.4.0");
		const lock = JSON.parse(git(dir, ["show", "next:package-lock.json"]));
		eq([lock.version, lock.packages[""].version], ["0.4.0", "0.4.0"], 'package-lock.json keeps 0.4.0 (root + packages[""])');
		eq(git(dir, ["show", "next:src/server.mjs"]), "export const timeoutMs = 15000;", "hotfix change carried into next");
		eq(git(dir, ["show", "next:src/feature.mjs"]), "export const feature = true;", "next's queued feature preserved");
		eq(
			calls.find((c) => c.path === "/git/trees").body.base_tree,
			git(dir, ["rev-parse", `${targetSha}^{tree}`]),
			"tree built on next's tree"
		);
		eq(
			calls.find((c) => c.path === "/git/trees").body.tree.map((i) => i.path),
			["src/server.mjs"],
			"tree changes vs next = the hotfix only (resolved version files equal next's)"
		);
		eq(calls.filter((c) => c.path === "/git/blobs").length, 0, "no uploads — the hotfix blob already exists on the remote");
		eq(calls.find((c) => c.method === "PATCH").body.force, false, "ref update is a fast-forward, never forced");
		eq(
			calls.map((c) => `${c.method} ${c.path}`).slice(-2),
			["POST /git/commits", "PATCH /git/refs/heads/next"],
			"commit created through the API, then the ref moved"
		);
	}

	console.log("\nfallback end-to-end — auto-merged package.json change alongside the version conflict:");
	{
		const { dir, targetSha, sourceSha } = makeRepo("auto-merged", {
			masterEdit: (write) => write("package.json", pkgJson("0.3.2", ',\n\t\t"lint": "eslint ."'))
		});
		const plan = planLocalMerge({ cwd: dir, targetSha, sourceSha });
		eq(plan.ok, true, "still version-only → accepted");
		const { apiFn, calls } = makeStubApi(dir);
		await publishMergeCommit({ cwd: dir, targetBranch: "next", targetSha, sourceSha, tree: plan.tree, message: "m", ctx: {}, apiFn });
		eq(calls.filter((c) => c.path === "/git/blobs").length, 1, "the merged package.json (a blob neither side has) is uploaded");
		const pkg = JSON.parse(git(dir, ["show", "next:package.json"]));
		eq([pkg.version, pkg.scripts.lint], ["0.4.0", "eslint ."], "next's version kept AND master's non-conflicting script merged");
	}

	console.log("\nfallback end-to-end — clean merge (no conflict at all):");
	{
		const base = makeRepo("clean");
		git(base.dir, ["checkout", "-q", "-b", "clean-next", `${base.sourceSha}~1`]);
		fs.writeFileSync(path.join(base.dir, "other.txt"), "x\n");
		git(base.dir, ["add", "-A"]);
		git(base.dir, ["commit", "-q", "-m", "feat: other"]);
		const r = planLocalMerge({ cwd: base.dir, targetSha: git(base.dir, ["rev-parse", "HEAD"]), sourceSha: base.sourceSha });
		eq([r.ok, r.resolutions], [true, []], "no conflicts → accepted with nothing resolved");
	}

	console.log("\nfallback end-to-end — non-version conflicts still fail:");
	{
		const readme = makeRepo("readme-conflict", {
			nextEdit: (write) => write("README.md", "# gh-broker (next)\n"),
			masterEdit: (write) => write("README.md", "# gh-broker (hotfix)\n")
		});
		const r = planLocalMerge({ cwd: readme.dir, targetSha: readme.targetSha, sourceSha: readme.sourceSha });
		eq(r.ok, false, "README.md conflict alongside the version conflict → declined");
		eq(r.reason.includes("README.md"), true, "reason names README.md");

		const dep = makeRepo("lock-dep-conflict", {
			nextEdit: (write) => write("package-lock.json", lockJson("0.3.2", "7.1.0")),
			masterEdit: (write) => write("package-lock.json", lockJson("0.3.2", "7.0.2"))
		});
		const rd = planLocalMerge({ cwd: dep.dir, targetSha: dep.targetSha, sourceSha: dep.sourceSha });
		eq(rd.ok, false, "conflicting nested dependency version in the lockfile → declined");
		eq(rd.reason.includes("node_modules/undici"), true, "reason names the dependency");

		const del = makeRepo("modify-delete", {
			nextEdit: (write) => write("src/server.mjs", "export const timeoutMs = 7000;\n"),
			masterEdit: () => fs.rmSync(path.join(scratch, "modify-delete", "src/server.mjs"))
		});
		const rdel = planLocalMerge({ cwd: del.dir, targetSha: del.targetSha, sourceSha: del.sourceSha });
		eq(rdel.ok, false, "modify/delete conflict → declined");
	}
} finally {
	fs.rmSync(scratch, { recursive: true, force: true });
}

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
