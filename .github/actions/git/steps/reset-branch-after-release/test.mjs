#!/usr/bin/env node
/**
 * @fileoverview Tests for reset-branch-after-release (#360): the pure helpers,
 * the compare-and-swap decision logic, and the late-commit detection / replay
 * / publish flow against real throwaway git repositories shaped like the v4
 * flow (PRs merged into next with merge commits, a release squash on master,
 * then a Dependabot-style merge landing on next after the release PR was cut).
 * Publishing goes through a stub api() that replays the Git Data API calls
 * against the same local object store. No network.
 * Run via `npm test` from the repo root.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	ZERO_SHA,
	buildCarriedMessage,
	buildCarriedPrComment,
	buildFailureIssueBody,
	buildLeasePushArgs,
	buildSummary,
	buildUpdateRefsVariables,
	classifyCasRefusal,
	compareAndSwapRef,
	decideAction,
	listLateCommits,
	parsePrNumberFromSubject,
	parseReleaseLabel,
	pickPrForCommit,
	planReplay,
	publishReplay,
	redact
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

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

console.log("parsePrNumberFromSubject:");
eq(parsePrNumberFromSubject("deps: bump prettier from 3.9.8 to 3.9.9 (#42)"), 42, "trailing (#N)");
eq(parsePrNumberFromSubject("fix: thing (#12) and more"), null, "(#N) not at the end");
eq(parsePrNumberFromSubject("chore: bump version"), null, "no PR");
eq(parsePrNumberFromSubject(undefined), null, "undefined");

console.log("\nparseReleaseLabel:");
eq(parseReleaseLabel("release: v1.1.7 - prettier bump\n\nbody"), "v1.1.7", "release: vX.Y.Z subject");
eq(parseReleaseLabel("release: 2.0.0"), "v2.0.0", "adds the v");
eq(parseReleaseLabel("feat: something"), "", "not a release");

console.log("\ndecideAction:");
eq(decideAction({ targetSha: "", releaseIsAncestor: false, candidateCount: 0 }), "create", "branch missing → create");
eq(decideAction({ targetSha: A, releaseIsAncestor: true, candidateCount: 0 }), "noop", "already contains the release → noop");
eq(
	decideAction({ targetSha: A, releaseIsAncestor: true, candidateCount: 3 }),
	"noop",
	"already on the release beats late commits (re-run)"
);
eq(decideAction({ targetSha: A, releaseIsAncestor: false, candidateCount: 0 }), "reset", "branch == release head → reset");
eq(decideAction({ targetSha: A, releaseIsAncestor: false, candidateCount: 2 }), "carry", "late commits → carry");

console.log("\nclassifyCasRefusal:");
eq(classifyCasRefusal(A, A), "refused", "unchanged tip → refused for another reason");
eq(classifyCasRefusal(A, B), "moved", "different tip → moved");
eq(classifyCasRefusal("", ""), "refused", "still missing → refused");
eq(classifyCasRefusal("", A), "moved", "created meanwhile → moved");

console.log("\nbuildUpdateRefsVariables / buildLeasePushArgs:");
eq(
	buildUpdateRefsVariables({ repositoryId: "R_1", targetBranch: "next", expectedSha: A, newSha: B }),
	{ input: { repositoryId: "R_1", refUpdates: [{ name: "refs/heads/next", beforeOid: A, afterOid: B, force: true }] } },
	"beforeOid = expected tip, forced"
);
eq(
	buildUpdateRefsVariables({ repositoryId: "R_1", targetBranch: "next", expectedSha: "", newSha: B }).input.refUpdates[0].beforeOid,
	ZERO_SHA,
	"missing branch → beforeOid all-zero (must not exist)"
);
eq(
	buildLeasePushArgs({ remote: "origin", targetBranch: "next", expectedSha: A, newSha: B }),
	["push", "origin", `${B}:refs/heads/next`, `--force-with-lease=refs/heads/next:${A}`],
	"explicit lease against the expected tip"
);
eq(
	buildLeasePushArgs({ remote: "origin", targetBranch: "next", expectedSha: "", newSha: B })[3],
	"--force-with-lease=refs/heads/next:",
	"empty lease → must not exist"
);

console.log("\nredact:");
eq(redact("https://x-access-token:ghs_secret@github.com/o/r.git"), "https://x-access-token:***@github.com/o/r.git", "masks the token");

console.log("\npickPrForCommit:");
const pulls = [
	{ number: 7, merged_at: "2026-10-04T06:36:00Z", merge_commit_sha: C, base: { ref: "next" } },
	{ number: 9, merged_at: "2026-10-04T06:36:00Z", merge_commit_sha: A, base: { ref: "next" } },
	{ number: 3, merged_at: null, merge_commit_sha: A, base: { ref: "next" } }
];
eq(pickPrForCommit(pulls, { sha: A, targetBranch: "next", subject: "x (#1)" }), 9, "exact merge_commit_sha match wins");
eq(pickPrForCommit(pulls, { sha: B, targetBranch: "next", subject: "x (#1)" }), 7, "else any merged PR into the target");
eq(pickPrForCommit(pulls, { sha: B, targetBranch: "hotfixes", subject: "x (#1)" }), 1, "else the subject's (#N)");
eq(pickPrForCommit(null, { sha: B, targetBranch: "next", subject: "chore: bump" }), null, "nothing → null");

console.log("\nmessages:");
{
	const msg = buildCarriedMessage({
		originalMessage: "deps: bump x (#42)\n\nbody\n",
		originalSha: A,
		targetBranch: "next",
		releaseLabel: "v1.1.7"
	});
	eq(msg.split("\n")[0], "deps: bump x (#42)", "subject kept (changelog picks up the (#N))");
	eq(msg.includes(`(cherry picked from commit ${A})`), true, "cherry-pick trailer names the original");
	eq(msg.includes("after release v1.1.7"), true, "names the release");
	const comment = buildCarriedPrComment({
		targetBranch: "next",
		releaseLabel: "v1.1.7",
		releasePr: "41",
		originalSha: A,
		carriedSha: B,
		runUrl: "https://run"
	});
	eq(comment.includes("`aaaaaaa` → `bbbbbbb`"), true, "PR comment shows original → carried");
	eq(comment.includes("(#41)"), true, "PR comment links the release PR");
	const body = buildFailureIssueBody({
		targetBranch: "next",
		releaseLabel: "v1.1.7",
		releaseSha: A,
		targetSha: B,
		reason: "conflict in x",
		commits: [{ sha: C, subject: "a | b", pr: 5 }]
	});
	eq(body.includes("**left untouched**"), true, "issue says the branch was left untouched");
	eq(body.includes("| `ccccccc` | #5 | a \\| b |"), true, "issue lists the stuck commit with escaped subject");
	const summary = buildSummary({
		targetBranch: "next",
		result: "carried",
		releaseSha: A,
		targetSha: B,
		resetSha: C,
		method: "graphql-cas",
		carried: [{ original: A, carried: C, subject: "deps (#2)", pr: 2 }],
		skipped: [{ original: B, subject: "feat (#1)" }],
		stuck: [],
		reason: ""
	});
	eq(summary.includes("| `aaaaaaa` | `ccccccc` | #2 | deps (#2) |"), true, "summary lists the carried commit");
	eq(summary.includes("Already in the release"), true, "summary lists skipped empties");
}

console.log("\ncompareAndSwapRef:");
{
	const mk = ({ remoteSeq, graphqlThrows = null, leaseThrows = null, restThrows = null }) => {
		const calls = [];
		let i = 0;
		return {
			calls,
			readRemote: async () => {
				calls.push("read");
				return remoteSeq[Math.min(i++, remoteSeq.length - 1)];
			},
			graphqlCas: async () => {
				calls.push("graphql");
				if (graphqlThrows) throw new Error(graphqlThrows);
			},
			leasePush: async () => {
				calls.push("lease");
				if (leaseThrows) throw new Error(leaseThrows);
			},
			restForce: async () => {
				calls.push("rest");
				if (restThrows) throw new Error(restThrows);
			}
		};
	};
	const base = { targetBranch: "next", expectedSha: A, newSha: B, allowUnleased: true };

	let s = mk({ remoteSeq: [A] });
	let r = await compareAndSwapRef({ ...base, ...s });
	eq([r.ok, r.method, s.calls], [true, "graphql-cas", ["graphql"]], "GraphQL CAS succeeds → done, nothing else tried");

	s = mk({ remoteSeq: [C], graphqlThrows: "Expected ref to point to aaaa" });
	r = await compareAndSwapRef({ ...base, ...s });
	eq(
		[r.ok, r.moved, r.current, s.calls],
		[false, true, C, ["graphql", "read"]],
		"refused + branch moved → moved (re-plan), no fallback overwrite"
	);

	s = mk({ remoteSeq: [A, A], graphqlThrows: "Resource not accessible" });
	r = await compareAndSwapRef({ ...base, ...s });
	eq([r.ok, r.method, s.calls], [true, "git-lease", ["graphql", "read", "lease"]], "GraphQL refused, unmoved → lease push");

	s = mk({ remoteSeq: [A, C], graphqlThrows: "denied", leaseThrows: "! [rejected] (stale info)" });
	r = await compareAndSwapRef({ ...base, ...s });
	eq([r.ok, r.moved], [false, true], "lease rejected because the branch moved → moved");

	s = mk({ remoteSeq: [A, A, A], graphqlThrows: "denied", leaseThrows: "GH013 rule violation" });
	r = await compareAndSwapRef({ ...base, ...s });
	eq(
		[r.ok, r.method, s.calls],
		[true, "rest-unleased", ["graphql", "read", "lease", "read", "read", "rest"]],
		"both CAS refused, unmoved → guarded REST force"
	);

	s = mk({ remoteSeq: [A, A, C], graphqlThrows: "denied", leaseThrows: "GH013" });
	r = await compareAndSwapRef({ ...base, ...s });
	eq([r.ok, r.moved, s.calls.includes("rest")], [false, true, false], "moved right before the REST fallback → moved, no force");

	s = mk({ remoteSeq: [A, A], graphqlThrows: "denied", leaseThrows: "GH013" });
	r = await compareAndSwapRef({ ...base, ...s, allowUnleased: false });
	eq([r.ok, r.moved, s.calls.includes("rest")], [false, false, false], "allowUnleased=false → fails instead of forcing");

	s = mk({ remoteSeq: [B], graphqlThrows: "timeout after apply" });
	r = await compareAndSwapRef({ ...base, ...s });
	eq([r.ok, r.method], [true, "graphql-cas"], "error but the ref already points at the new tip → success");
}

// ---- end-to-end against real git repositories -----------------------------------

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "reset-branch-test-"));

function git(cwd, args, { input, env } = {}) {
	const r = spawnSync("git", args, { cwd, input, encoding: "utf8", env: { ...process.env, ...env } });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
	return r.stdout.trim();
}

/**
 * v4-shaped repo: master R0 → next gets PR #1 (merge commit) + a version bump
 * (H) → master gets the release squash R → next gets late PR #2 (merge commit)
 * after the release PR was cut. `afterRelease(write, commit)` may add extra
 * master changes (e.g. to make the release tree differ from H's).
 */
function makeRepo(name, { afterRelease, lateEdit } = {}) {
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
	const mergePr = (branch, msg, edit) => {
		git(dir, ["checkout", "-q", "-b", branch, "next"]);
		edit();
		commit(`${branch} work`);
		git(dir, ["checkout", "-q", "next"]);
		git(dir, ["merge", "-q", "--no-ff", branch, "-m", msg]);
	};

	write("package.json", '{\n\t"name": "x",\n\t"version": "1.0.0"\n}\n');
	write("src/a.mjs", "export const a = 1;\n");
	write("src/shared.mjs", "export const shared = 'base';\n");
	commit("release: v1.0.0");
	const r0 = git(dir, ["rev-parse", "HEAD"]);

	git(dir, ["checkout", "-q", "-b", "next"]);
	mergePr("feat-a", "feat: a two (#1)", () => write("src/a.mjs", "export const a = 2;\n"));
	write("package.json", '{\n\t"name": "x",\n\t"version": "1.1.0"\n}\n');
	commit("chore: bump version to 1.1.0");
	const head = git(dir, ["rev-parse", "next"]);

	git(dir, ["checkout", "-q", "master"]);
	git(dir, ["merge", "-q", "--squash", "next"]);
	git(dir, ["commit", "-q", "-m", "release: v1.1.0 - a two"]);
	afterRelease?.(write, commit);
	const release = git(dir, ["rev-parse", "master"]);

	git(dir, ["checkout", "-q", "next"]);
	mergePr("dep-b", "deps: bump b from 1 to 2 (#2)", lateEdit || (() => write("src/b.mjs", "export const b = 2;\n")));
	const target = git(dir, ["rev-parse", "next"]);
	return { dir, r0, head, release, target };
}

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
		throw new Error(`unexpected API call ${method} ${apiPath}`);
	};
	return { apiFn, calls };
}

const messageFor = (step) =>
	buildCarriedMessage({
		originalMessage: step.original.message,
		originalSha: step.original.sha,
		targetBranch: "next",
		releaseLabel: "v1.1.0"
	});

try {
	console.log("\nnext == release head (no late merges):");
	{
		const { dir, head, release } = makeRepo("exact");
		const late = listLateCommits({ cwd: dir, targetSha: head, releaseSha: release, releaseHeadSha: head });
		eq(late.length, 0, "no late commits when next is the release head");
		eq(decideAction({ targetSha: head, releaseIsAncestor: false, candidateCount: late.length }), "reset", "→ reset next to the release");
	}

	console.log("\nnext moved after the release PR was cut (the #360 race):");
	{
		const { dir, head, release, target } = makeRepo("late");
		const late = listLateCommits({ cwd: dir, targetSha: target, releaseSha: release, releaseHeadSha: head });
		eq(
			late.map((c) => [c.subject, c.parents.length]),
			[["deps: bump b from 1 to 2 (#2)", 2]],
			"only the late merge is a candidate (the shipped #1 + bump are excluded via the head)"
		);
		const plan = planReplay({ cwd: dir, baseSha: release, commits: late });
		eq([plan.conflict, plan.steps.map((s) => s.empty)], [null, [false]], "replay is clean and non-empty");
		eq(plan.steps[0].tree, git(dir, ["rev-parse", `${target}^{tree}`]), "replayed tree == next's tree (release tree == head tree)");

		const { apiFn, calls } = makeStubApi(dir);
		const pub = await publishReplay({ cwd: dir, baseSha: release, steps: plan.steps, messageFor, ctx: {}, apiFn });
		eq(
			calls.map((c) => c.path),
			["/git/commits"],
			"existing tree reused — only a commit is created (no blobs/trees)"
		);
		eq(
			git(dir, ["rev-list", "--parents", "-n", "1", pub.tip]).split(" ").slice(1),
			[release],
			"carried commit is single-parent on the release (flattened merge)"
		);
		eq(git(dir, ["show", `${pub.tip}:src/b.mjs`]), "export const b = 2;", "late change present");
		eq(git(dir, ["show", `${pub.tip}:src/a.mjs`]), "export const a = 2;", "released change present");
		eq(git(dir, ["log", "-1", "--format=%s", pub.tip]), "deps: bump b from 1 to 2 (#2)", "subject preserved");
		eq(
			spawnSync("git", ["merge-base", "--is-ancestor", head, pub.tip], { cwd: dir }).status,
			1,
			"pre-squash history (the release head) is NOT reachable from the new next"
		);
		eq(git(dir, ["rev-list", "--count", `${release}..${pub.tip}`]), "1", "master..next = exactly the carried commit");
		eq(
			pub.carried.map((c) => [c.original, c.subject]),
			[[late[0].sha, late[0].subject]],
			"carried list maps original → new"
		);
	}

	console.log("\nrelease head unknown (fallback: replay everything not on the release, skip empties):");
	{
		const { dir, release, target } = makeRepo("no-head");
		const late = listLateCommits({ cwd: dir, targetSha: target, releaseSha: release, releaseHeadSha: "" });
		eq(
			late.map((c) => c.subject),
			["feat: a two (#1)", "chore: bump version to 1.1.0", "deps: bump b from 1 to 2 (#2)"],
			"all first-parent commits since the last release"
		);
		const plan = planReplay({ cwd: dir, baseSha: release, commits: late });
		eq(
			plan.steps.map((s) => s.empty),
			[true, true, false],
			"shipped commits replay as empty; only the late merge carries"
		);
		const { apiFn } = makeStubApi(dir);
		const pub = await publishReplay({ cwd: dir, baseSha: release, steps: plan.steps, messageFor, ctx: {}, apiFn });
		eq(git(dir, ["rev-list", "--count", `${release}..${pub.tip}`]), "1", "one carried commit");
	}

	console.log("\nrelease tree differs from the head (extra master change) — tree built via the API:");
	{
		const { dir, head, release, target } = makeRepo("diverged", {
			afterRelease: (write, commit) => {
				write("src/master-only.mjs", "export const m = true;\n");
				commit("fix: master-only follow-up");
			}
		});
		const late = listLateCommits({ cwd: dir, targetSha: target, releaseSha: release, releaseHeadSha: head });
		const plan = planReplay({ cwd: dir, baseSha: release, commits: late });
		eq(plan.conflict, null, "no conflict");
		const { apiFn, calls } = makeStubApi(dir);
		const pub = await publishReplay({ cwd: dir, baseSha: release, steps: plan.steps, messageFor, ctx: {}, apiFn });
		eq(
			calls.map((c) => c.path),
			["/git/trees", "/git/commits"],
			"tree created on the release tree, then the commit"
		);
		eq(
			calls[0].body.tree.map((i) => i.path),
			["src/b.mjs"],
			"tree change = the late file only"
		);
		eq(git(dir, ["show", `${pub.tip}:src/master-only.mjs`]), "export const m = true;", "master's change kept");
		eq(git(dir, ["show", `${pub.tip}:src/b.mjs`]), "export const b = 2;", "late change applied");
	}

	console.log("\ncarry conflict → reported, nothing published:");
	{
		const { dir, head, release, target } = makeRepo("conflict", {
			afterRelease: (write, commit) => {
				write("src/shared.mjs", "export const shared = 'master';\n");
				commit("fix: master edits shared");
			},
			lateEdit: () => fs.writeFileSync(path.join(scratch, "conflict", "src/shared.mjs"), "export const shared = 'late';\n")
		});
		const late = listLateCommits({ cwd: dir, targetSha: target, releaseSha: release, releaseHeadSha: head });
		const plan = planReplay({ cwd: dir, baseSha: release, commits: late });
		eq(plan.conflict?.original.sha, late[0].sha, "conflict names the commit that could not be replayed");
		eq(/shared\.mjs/.test(plan.conflict?.details || ""), true, "conflict details name the file");
	}
} finally {
	fs.rmSync(scratch, { recursive: true, force: true });
}

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
