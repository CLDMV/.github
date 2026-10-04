/**
 * @fileoverview Bring an integration branch (next / hotfixes) onto a release
 * commit without dropping work that merged into it after the release PR was
 * cut. Fixes #360: next-reset used to force-reset `next` to master's release
 * squash unconditionally, so a PR (usually a Dependabot / bot auto-merge) that
 * merged into `next` between the release merge and the reset vanished — not
 * in the release, not on `next`, still shown as merged.
 *
 * Algorithm (R = release commit on master, H = the release PR's head SHA,
 * N = the branch's current tip):
 *
 *   1. Branch missing                      → create it at R.
 *   2. R is already an ancestor of N       → no-op (already on the release;
 *                                            makes re-runs idempotent).
 *   3. No first-parent commit of N outside
 *      H and R (N == H in the normal case) → move the branch N → R.
 *   4. Otherwise ("late" commits exist)    → replay each late first-parent
 *      commit, oldest first, onto R. A merge commit is replayed against its
 *      first parent (the branch side), i.e. flattened to one commit carrying
 *      the PR's change — keeping its "(#N)" subject — so the pre-squash
 *      history the release already shipped never becomes reachable from the
 *      branch again (that would put the whole release back into the next
 *      release PR's range). A replay whose change is already in R is
 *      empty and skipped. The replay is computed locally (git merge-tree with
 *      an explicit merge base — no working tree) and published through the
 *      Git Data API, so GitHub signs each commit for the bot App, exactly like
 *      merge-master-into-branch.
 *      A conflict stops everything: the branch is NOT touched (nothing is
 *      dropped), the step fails, an issue is opened, and every affected PR
 *      is commented on.
 *
 * Every ref update is a compare-and-swap against N, the tip the plan was
 * built from:
 *   - GraphQL `updateRefs` with `beforeOid: N` (atomic server-side check);
 *   - else `git push --force-with-lease=refs/heads/<branch>:N`;
 *   - a refusal is classified by re-reading the branch: if it moved, the
 *     whole plan is rebuilt from the new tip (bounded by max-attempts) —
 *     a merge that lands mid-step is carried, never overwritten;
 *   - only when both CAS paths are refused while the branch is still at N
 *     (e.g. a ruleset rejects them) does an optional REST force update run,
 *     guarded by a re-read right before it and followed by an audit of PRs
 *     merged into the branch since the release.
 *
 * Pure helpers are exported for test.mjs; the side-effecting main is gated to
 * script entry.
 *
 * @module @cldmv/.github.git.steps.reset-branch-after-release
 */

import { spawnSync } from "node:child_process";
import { appendSummary, getBooleanInput, getInput, setOutputs } from "../../../common/common/core.mjs";
import { api, parseRepo } from "../../../github/api/_api/core.mjs";
import { buildTreeItems, parseDiffTreeRaw, parseMergeTreeOutput } from "../../../github/steps/merge-master-into-branch/action.mjs";

/** The all-zero object id: "this ref must not exist" in a ref update. */
export const ZERO_SHA = "0000000000000000000000000000000000000000";

// ---- pure helpers -------------------------------------------------------------

/**
 * Pull the PR number out of a squash/merge subject's trailing "(#N)".
 *
 * @public
 * @param {string} subject
 * @returns {number|null}
 */
export function parsePrNumberFromSubject(subject) {
	const m = /\(#(\d+)\)\s*$/.exec(String(subject || ""));
	return m ? Number(m[1]) : null;
}

/**
 * Parse "vX.Y.Z" from a `release: vX.Y.Z - …` commit message.
 *
 * @public
 * @param {string} message
 * @returns {string} "" when absent.
 */
export function parseReleaseLabel(message) {
	const m = /^release:\s*(v?\d+\.\d+\.\d+[0-9A-Za-z.+-]*)/i.exec(String(message || "").trim());
	if (!m) return "";
	return m[1].startsWith("v") ? m[1] : `v${m[1]}`;
}

/**
 * Decide what to do with the branch.
 *
 * @public
 * @param {object} args
 * @param {string} args.targetSha - Current branch tip ("" when the branch is missing).
 * @param {boolean} args.releaseIsAncestor - Whether the release commit is an ancestor of (or equal to) the tip.
 * @param {number} args.candidateCount - Late first-parent commits outside the release.
 * @returns {"create"|"noop"|"reset"|"carry"}
 */
export function decideAction({ targetSha, releaseIsAncestor, candidateCount }) {
	if (!targetSha) return "create";
	if (releaseIsAncestor) return "noop";
	if (candidateCount === 0) return "reset";
	return "carry";
}

/**
 * Message for a replayed commit: the original message, plus a cherry-pick
 * trailer naming the original SHA and a line saying why it was replayed.
 *
 * @public
 * @param {object} args
 * @param {string} args.originalMessage
 * @param {string} args.originalSha
 * @param {string} args.targetBranch
 * @param {string} args.releaseLabel
 * @returns {string}
 */
export function buildCarriedMessage({ originalMessage, originalSha, targetBranch, releaseLabel }) {
	const body = String(originalMessage || "").replace(/\s+$/, "");
	const release = releaseLabel ? `release ${releaseLabel}` : "the release";
	return `${body}\n\n(cherry picked from commit ${originalSha})\nCarried forward onto ${targetBranch} after ${release}: merged after the release PR was cut, so it did not ship in it.`;
}

/**
 * Classify a refused compare-and-swap by re-reading the branch.
 *
 * @public
 * @param {string} expectedSha - The tip the plan was built from ("" = must not exist).
 * @param {string} currentSha - The tip read back after the refusal ("" = missing).
 * @returns {"moved"|"refused"}
 */
export function classifyCasRefusal(expectedSha, currentSha) {
	return (expectedSha || "") === (currentSha || "") ? "refused" : "moved";
}

/**
 * Build the `updateRefs` GraphQL variables for a compare-and-swap.
 *
 * @public
 * @param {object} args
 * @param {string} args.repositoryId
 * @param {string} args.targetBranch
 * @param {string} args.expectedSha - "" when the branch must not exist yet.
 * @param {string} args.newSha
 * @returns {{ input: { repositoryId: string, refUpdates: Array<{ name: string, beforeOid: string, afterOid: string, force: boolean }> } }}
 */
export function buildUpdateRefsVariables({ repositoryId, targetBranch, expectedSha, newSha }) {
	return {
		input: {
			repositoryId,
			refUpdates: [{ name: `refs/heads/${targetBranch}`, beforeOid: expectedSha || ZERO_SHA, afterOid: newSha, force: true }]
		}
	};
}

/**
 * Argv for the git-push compare-and-swap fallback.
 *
 * @public
 * @param {object} args
 * @param {string} args.remote
 * @param {string} args.targetBranch
 * @param {string} args.expectedSha - "" when the branch must not exist yet.
 * @param {string} args.newSha
 * @returns {string[]}
 */
export function buildLeasePushArgs({ remote, targetBranch, expectedSha, newSha }) {
	return ["push", remote, `${newSha}:refs/heads/${targetBranch}`, `--force-with-lease=refs/heads/${targetBranch}:${expectedSha || ""}`];
}

/**
 * Redact x-access-token credentials from a string before logging it.
 *
 * @public
 * @param {string} s
 * @returns {string}
 */
export function redact(s) {
	return typeof s === "string" ? s.replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@") : s;
}

/**
 * Pick the PR a carried commit came from out of a `GET /commits/{sha}/pulls`
 * listing: the merged PR into the target whose merge commit is this SHA, else
 * any merged PR into the target, else the subject's "(#N)".
 *
 * @public
 * @param {Array<{ number: number, merged_at?: string|null, merge_commit_sha?: string, base?: { ref?: string } }>} pulls
 * @param {object} args
 * @param {string} args.sha
 * @param {string} args.targetBranch
 * @param {string} args.subject
 * @returns {number|null}
 */
export function pickPrForCommit(pulls, { sha, targetBranch, subject }) {
	const list = Array.isArray(pulls) ? pulls : [];
	const intoTarget = list.filter((p) => p?.merged_at && p?.base?.ref === targetBranch);
	const exact = intoTarget.find((p) => p.merge_commit_sha === sha);
	if (exact) return exact.number;
	if (intoTarget.length > 0) return intoTarget[0].number;
	return parsePrNumberFromSubject(subject);
}

/**
 * Comment posted on a PR whose merge was carried forward.
 *
 * @public
 * @param {object} args
 * @returns {string}
 */
export function buildCarriedPrComment({ targetBranch, releaseLabel, releasePr, originalSha, carriedSha, runUrl }) {
	const release = releaseLabel ? `release **${releaseLabel}**` : "the latest release";
	const via = releasePr ? ` (#${releasePr})` : "";
	return [
		`♻️ This PR merged into \`${targetBranch}\` after the release PR for ${release}${via} was cut, so its change did not ship in that release.`,
		"",
		`When \`${targetBranch}\` was moved onto the release, its change was carried forward instead of being dropped: \`${originalSha.slice(0, 7)}\` → \`${carriedSha.slice(0, 7)}\` on \`${targetBranch}\`. It will ship with the next release.`,
		runUrl ? `\n[next-reset run](${runUrl})` : ""
	]
		.join("\n")
		.trim();
}

/**
 * Comment posted on a PR whose merge could not be carried forward.
 *
 * @public
 * @param {object} args
 * @returns {string}
 */
export function buildStuckPrComment({ targetBranch, releaseLabel, reason, issueUrl, runUrl, untouched = true }) {
	const release = releaseLabel ? `release **${releaseLabel}**` : "the latest release";
	return [
		`⚠️ This PR merged into \`${targetBranch}\` after the release PR for ${release} was cut, so its change did not ship in that release.`,
		"",
		untouched
			? `Moving \`${targetBranch}\` onto the release could not carry it forward automatically (${reason}). \`${targetBranch}\` was left as it was, so nothing has been dropped, but it needs a manual rebase onto master before the next release.`
			: `Its change is not on \`${targetBranch}\` after the post-release sync (${reason}). It needs to be re-applied (re-open or re-create this PR against \`${targetBranch}\`).`,
		issueUrl ? `\nTracking issue: ${issueUrl}` : "",
		runUrl ? `\n[next-reset run](${runUrl})` : ""
	]
		.join("\n")
		.trim();
}

/** Title of the issue opened when a carry cannot be completed. */
export function failureIssueTitle(targetBranch) {
	return `next-reset could not move ${targetBranch} onto the release without dropping commits`;
}

/**
 * Body of the issue opened when a carry cannot be completed.
 *
 * @public
 * @param {object} args
 * @returns {string}
 */
export function buildFailureIssueBody({ targetBranch, releaseLabel, releaseSha, targetSha, reason, commits, runUrl, untouched = true }) {
	const rows = commits.map((c) => `| \`${c.sha.slice(0, 7)}\` | ${c.pr ? `#${c.pr}` : "—"} | ${escapeCell(c.subject)} |`);
	return [
		`After ${releaseLabel ? `release ${releaseLabel}` : "a release"} (\`${releaseSha.slice(0, 7)}\`), \`${targetBranch}\` (\`${(targetSha || "").slice(0, 7)}\`) had commits that are not in the release, and next-reset could not carry them forward onto it: ${reason}.`,
		"",
		untouched
			? `\`${targetBranch}\` was **left untouched**, so nothing was dropped. Until it is fixed, \`${targetBranch}\` still carries the pre-release history and the next release PR will list already-shipped commits.`
			: `\`${targetBranch}\` WAS updated, and the commits below are not on it: they must be re-applied.`,
		"",
		"| Commit | PR | Subject |",
		"| --- | --- | --- |",
		...rows,
		"",
		"To fix: replay these commits onto master by hand (for each: `git cherry-pick -m 1 <sha>` for a merge commit, plain `git cherry-pick <sha>` otherwise), resolve conflicts, and point the branch at the result, then re-run the next-reset workflow.",
		runUrl ? `\nRun: ${runUrl}` : ""
	].join("\n");
}

/**
 * Markdown step summary for the result.
 *
 * @public
 * @param {object} args
 * @returns {string}
 */
export function buildSummary({ targetBranch, result, releaseSha, targetSha, resetSha, method, carried, skipped, stuck, reason }) {
	const lines = [`### ♻️ ${targetBranch}: ${result}`, ""];
	lines.push(`- release commit: \`${(releaseSha || "").slice(0, 7)}\``);
	lines.push(`- ${targetBranch} before: \`${(targetSha || "(missing)").slice(0, 7)}\``);
	if (resetSha) lines.push(`- ${targetBranch} after: \`${resetSha.slice(0, 7)}\`${method ? ` (via ${method})` : ""}`);
	if (reason) lines.push(`- ❌ ${reason}`);
	if (carried.length > 0) {
		lines.push(
			"",
			"**Carried forward** (merged after the release PR was cut):",
			"",
			"| Original | Carried | PR | Subject |",
			"| --- | --- | --- | --- |"
		);
		for (const c of carried)
			lines.push(
				`| \`${c.original.slice(0, 7)}\` | \`${c.carried.slice(0, 7)}\` | ${c.pr ? `#${c.pr}` : "—"} | ${escapeCell(c.subject)} |`
			);
	}
	if (skipped.length > 0) {
		lines.push("", "**Already in the release** (replayed as empty, skipped):", "");
		for (const s of skipped) lines.push(`- \`${s.original.slice(0, 7)}\` ${escapeCell(s.subject)}`);
	}
	if (stuck.length > 0) {
		lines.push("", "**NOT carried** (branch left untouched):", "", "| Commit | PR | Subject |", "| --- | --- | --- |");
		for (const s of stuck) lines.push(`| \`${s.sha.slice(0, 7)}\` | ${s.pr ? `#${s.pr}` : "—"} | ${escapeCell(s.subject)} |`);
	}
	return lines.join("\n");
}

function escapeCell(s) {
	return String(s || "").replace(/\|/g, "\\|");
}

// ---- local git ------------------------------------------------------------------

/**
 * Run git; never throws. Returns { status, stdout, stderr }.
 *
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ input?: string, env?: Record<string, string> }} [opts]
 */
function git(cwd, args, { input, env } = {}) {
	const r = spawnSync("git", args, { cwd, input, encoding: "utf8", maxBuffer: 1024 * 1024 * 256, env: { ...process.env, ...env } });
	return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || r.error?.message || "" };
}

function gitOk(cwd, args, opts) {
	const r = git(cwd, args, opts);
	if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${redact(r.stderr.trim()) || `exit ${r.status}`}`);
	return r.stdout.trim();
}

/** True when `ancestor` is an ancestor of (or equal to) `descendant`. */
export function isAncestor(cwd, ancestor, descendant) {
	return git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
}

/** True when the object exists locally as a commit. */
export function hasCommit(cwd, sha) {
	return !!sha && git(cwd, ["cat-file", "-e", `${sha}^{commit}`]).status === 0;
}

/**
 * List the branch's late commits: first-parent commits of the tip that are
 * reachable from neither the release commit nor the release PR's head.
 * Oldest first.
 *
 * @public
 * @param {object} args
 * @param {string} args.cwd
 * @param {string} args.targetSha
 * @param {string} args.releaseSha
 * @param {string} [args.releaseHeadSha] - Omitted when unknown / not available locally.
 * @returns {Array<{ sha: string, parents: string[], subject: string, message: string }>}
 */
export function listLateCommits({ cwd, targetSha, releaseSha, releaseHeadSha }) {
	const args = ["rev-list", "--reverse", "--first-parent", targetSha, `^${releaseSha}`];
	if (releaseHeadSha) args.push(`^${releaseHeadSha}`);
	const shas = gitOk(cwd, args).split("\n").filter(Boolean);
	return shas.map((sha) => {
		const parents = gitOk(cwd, ["rev-list", "--parents", "-n", "1", sha]).split(" ").slice(1);
		const message = git(cwd, ["log", "-1", "--format=%B", sha]).stdout;
		return { sha, parents, subject: message.split("\n")[0], message };
	});
}

/**
 * Replay commits onto a base locally, without a working tree. Each commit is
 * three-way merged against its FIRST parent (git merge-tree --merge-base),
 * i.e. `git cherry-pick -m 1` for merges and a plain cherry-pick otherwise.
 * Intermediate commits are throwaway local objects (never pushed) so the next
 * replay has a commit to merge into; only the resulting trees matter.
 *
 * @public
 * @param {object} args
 * @param {string} args.cwd
 * @param {string} args.baseSha - The release commit.
 * @param {Array<{ sha: string, parents: string[], subject: string, message: string }>} args.commits
 * @returns {{ steps: Array<{ original: object, tree: string, empty: boolean }>, conflict: null | { original: object, details: string } }}
 */
export function planReplay({ cwd, baseSha, commits }) {
	const env = {
		GIT_AUTHOR_NAME: "next-reset",
		GIT_AUTHOR_EMAIL: "next-reset@localhost.invalid",
		GIT_COMMITTER_NAME: "next-reset",
		GIT_COMMITTER_EMAIL: "next-reset@localhost.invalid"
	};
	let current = baseSha;
	let currentTree = gitOk(cwd, ["rev-parse", `${baseSha}^{tree}`]);
	const steps = [];
	for (const commit of commits) {
		if (commit.parents.length === 0) {
			return { steps, conflict: { original: commit, details: "root commit (no parent) cannot be replayed" } };
		}
		const mainline = commit.parents[0];
		const mt = git(cwd, [
			"-c",
			"merge.conflictStyle=merge",
			"merge-tree",
			"--write-tree",
			"-z",
			"--messages",
			`--merge-base=${mainline}`,
			current,
			commit.sha
		]);
		if (mt.status !== 0 && mt.status !== 1) {
			throw new Error(`git merge-tree failed (needs git >= 2.40): ${mt.stderr.trim() || `exit ${mt.status}`}`);
		}
		const parsed = parseMergeTreeOutput(mt.stdout);
		if (mt.status === 1) {
			const paths = [...new Set(parsed.entries.map((e) => e.path))];
			const msgs = parsed.messages.filter((m) => m.type.startsWith("CONFLICT")).map((m) => m.message);
			return { steps, conflict: { original: commit, details: msgs.length > 0 ? msgs.join("; ") : `conflict in ${paths.join(", ")}` } };
		}
		const empty = parsed.tree === currentTree;
		steps.push({ original: commit, tree: parsed.tree, empty });
		if (!empty) {
			current = gitOk(cwd, ["commit-tree", parsed.tree, "-p", current, "-m", `replay ${commit.sha}`], { env });
			currentTree = parsed.tree;
		}
	}
	return { steps, conflict: null };
}

/**
 * Publish a replay plan through the Git Data API: one commit per non-empty
 * step, chained onto the release commit. When a step's tree equals the
 * original commit's tree (the common case: the release tree equals the
 * release PR head's tree) it already exists on the remote and is reused
 * as-is; otherwise the tree is built on the previous tree from the changed
 * entries, uploading only blobs the remote may not have, and checked against
 * the locally computed tree before committing. Commits are created without
 * author/committer overrides, so GitHub signs them for the bot App.
 *
 * @public
 * @param {object} args
 * @param {string} args.cwd
 * @param {string} args.baseSha
 * @param {ReturnType<typeof planReplay>["steps"]} args.steps
 * @param {(step: object) => string} args.messageFor
 * @param {object} args.ctx - { token, owner, repo } for api().
 * @param {typeof api} [args.apiFn]
 * @returns {Promise<{ tip: string, carried: Array<{ original: string, carried: string, subject: string, verified: unknown }> }>}
 */
export async function publishReplay({ cwd, baseSha, steps, messageFor, ctx, apiFn = api }) {
	let parent = baseSha;
	let parentTree = gitOk(cwd, ["rev-parse", `${baseSha}^{tree}`]);
	const carried = [];
	for (const step of steps) {
		if (step.empty) continue;
		const originalTree = gitOk(cwd, ["rev-parse", `${step.original.sha}^{tree}`]);
		let remoteTree = step.tree;
		if (step.tree !== originalTree) {
			const remoteBlobs = new Set();
			// Blobs in the original commit and in the parent tree are on the remote already.
			for (const ref of [step.original.sha, parentTree]) {
				for (const line of gitOk(cwd, ["ls-tree", "-r", "-z", ref]).split("\0").filter(Boolean))
					remoteBlobs.add(line.split("\t")[0].split(" ")[2]);
			}
			const changes = parseDiffTreeRaw(git(cwd, ["diff-tree", "-r", "-z", "--no-renames", parentTree, step.tree]).stdout);
			const items = buildTreeItems(changes, remoteBlobs);
			for (const item of items.filter((i) => i.upload)) {
				const res = await apiFn("POST", "/git/blobs", { content: blobBase64(cwd, item.sha), encoding: "base64" }, ctx);
				if (res?.sha !== item.sha) throw new Error(`Uploaded blob for ${item.path} came back as ${res?.sha}, expected ${item.sha}`);
			}
			const res = await apiFn("POST", "/git/trees", { base_tree: parentTree, tree: items.map(({ upload: _, ...rest }) => rest) }, ctx);
			remoteTree = res?.sha || "";
			if (remoteTree !== step.tree)
				throw new Error(`Remote tree ${remoteTree} does not match the locally replayed tree ${step.tree} — refusing to commit`);
		}
		const commit = await apiFn("POST", "/git/commits", { message: messageFor(step), tree: remoteTree, parents: [parent] }, ctx);
		if (!commit?.sha) throw new Error("POST /git/commits returned no SHA");
		carried.push({
			original: step.original.sha,
			carried: commit.sha,
			subject: step.original.subject,
			verified: commit.verification?.verified
		});
		parent = commit.sha;
		parentTree = remoteTree;
	}
	return { tip: parent, carried };
}

function blobBase64(cwd, sha) {
	const r = spawnSync("git", ["cat-file", "blob", sha], { cwd, maxBuffer: 1024 * 1024 * 256 });
	if (r.status !== 0) throw new Error(`git cat-file blob ${sha} failed: ${r.stderr?.toString().trim()}`);
	return r.stdout.toString("base64");
}

// ---- compare-and-swap ref update -------------------------------------------------

/**
 * Point the branch at `newSha` only if it is still at `expectedSha`.
 *
 * Paths, in order: GraphQL updateRefs (beforeOid), git push
 * --force-with-lease; after each refusal the branch is re-read — a moved
 * branch returns { moved: true } so the caller re-plans. Only if both are
 * refused with the branch unmoved, and `allowUnleased`, does a REST force
 * update run behind a fresh re-read.
 *
 * @public
 * @param {object} args
 * @param {string} args.targetBranch
 * @param {string} args.expectedSha - "" = the branch must not exist.
 * @param {string} args.newSha
 * @param {boolean} args.allowUnleased
 * @param {() => Promise<string>} args.readRemote - Current remote tip ("" when missing).
 * @param {(vars: object) => Promise<void>} args.graphqlCas - Throws on refusal.
 * @param {(argsForPush: object) => Promise<void>} args.leasePush - Throws on refusal.
 * @param {(sha: string, exists: boolean) => Promise<void>} args.restForce - Throws on failure.
 * @returns {Promise<{ ok: boolean, moved: boolean, method: string, current: string, errors: string[] }>}
 */
export async function compareAndSwapRef({
	targetBranch,
	expectedSha,
	newSha,
	allowUnleased,
	readRemote,
	graphqlCas,
	leasePush,
	restForce
}) {
	const errors = [];
	for (const [method, attempt] of [
		["graphql-cas", () => graphqlCas({ targetBranch, expectedSha, newSha })],
		["git-lease", () => leasePush({ targetBranch, expectedSha, newSha })]
	]) {
		try {
			await attempt();
			return { ok: true, moved: false, method, current: newSha, errors };
		} catch (e) {
			errors.push(`${method}: ${redact(e.message)}`);
			const current = await readRemote();
			if (current === newSha) return { ok: true, moved: false, method, current, errors };
			if (classifyCasRefusal(expectedSha, current) === "moved") return { ok: false, moved: true, method, current, errors };
		}
	}
	if (!allowUnleased) return { ok: false, moved: false, method: "", current: expectedSha, errors };
	const current = await readRemote();
	if (classifyCasRefusal(expectedSha, current) === "moved") return { ok: false, moved: true, method: "rest-unleased", current, errors };
	try {
		await restForce(newSha, !!expectedSha);
		return { ok: true, moved: false, method: "rest-unleased", current: newSha, errors };
	} catch (e) {
		errors.push(`rest-unleased: ${redact(e.message)}`);
		return { ok: false, moved: false, method: "", current: await readRemote(), errors };
	}
}

// ---- side-effecting main flow (gated to script entry only) ----------------------

async function graphql(token, query, variables) {
	const res = await fetch("https://api.github.com/graphql", {
		method: "POST",
		headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "Content-Type": "application/json" },
		body: JSON.stringify({ query, variables })
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`GraphQL ${res.status}: ${text}`);
	const json = JSON.parse(text);
	if (json.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
	return json.data;
}

async function main() {
	const targetBranch = getInput("target-branch", { required: true });
	const releaseSha = getInput("release-sha", { required: true });
	let releaseHeadSha = getInput("release-head-sha");
	const releasePr = getInput("release-pr-number");
	const releaseMergedAt = getInput("release-merged-at");
	const token = getInput("github-token", { required: true });
	const repository = getInput("repository") || process.env.GITHUB_REPOSITORY;
	const maxAttempts = Math.max(1, parseInt(getInput("max-attempts") || "3", 10) || 3);
	const allowUnleased = getBooleanInput("allow-unleased-fallback", true);
	const openIssue = getBooleanInput("open-issue-on-failure", true);
	const dryRun = getBooleanInput("dry-run", false);
	const { owner, repo } = parseRepo(repository);
	const ctx = { token, owner, repo };
	const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
	const remote = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
	const runUrl = process.env.GITHUB_RUN_ID
		? `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
		: "";

	if (git(cwd, ["rev-parse", "--is-inside-work-tree"]).stdout.trim() !== "true") {
		throw new Error("no git checkout in the workspace (the calling job must check out the repository with full history)");
	}

	const fetchArgs = ["fetch", "--no-tags", "--quiet"];
	if (git(cwd, ["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true") fetchArgs.push("--unshallow");
	const fetchSha = (sha) =>
		hasCommit(cwd, sha) || git(cwd, ["fetch", "--no-tags", "--quiet", remote, sha]).status === 0 || hasCommit(cwd, sha);
	const readRemote = async () => {
		const r = git(cwd, ["ls-remote", remote, `refs/heads/${targetBranch}`]);
		if (r.status !== 0) throw new Error(`ls-remote ${targetBranch} failed: ${redact(r.stderr.trim())}`);
		return r.stdout.split("\t")[0].trim();
	};

	if (!fetchSha(releaseSha)) throw new Error(`release commit ${releaseSha} is not available`);
	const releaseLabel = getInput("release-label") || parseReleaseLabel(git(cwd, ["log", "-1", "--format=%B", releaseSha]).stdout);

	let repositoryId = "";
	const graphqlCas = async ({ expectedSha, newSha }) => {
		if (!repositoryId) {
			const data = await graphql(token, "query($o:String!,$n:String!){repository(owner:$o,name:$n){id}}", { o: owner, n: repo });
			repositoryId = data?.repository?.id || "";
			if (!repositoryId) throw new Error("could not resolve the repository node id");
		}
		await graphql(
			token,
			"mutation($input:UpdateRefsInput!){updateRefs(input:$input){clientMutationId}}",
			buildUpdateRefsVariables({ repositoryId, targetBranch, expectedSha, newSha })
		);
	};
	const leasePush = async ({ expectedSha, newSha }) => {
		if (!fetchSha(newSha)) throw new Error(`could not fetch ${newSha} for the lease push`);
		const r = git(cwd, buildLeasePushArgs({ remote, targetBranch, expectedSha, newSha }));
		if (r.status !== 0) throw new Error(r.stderr.trim() || `git push exit ${r.status}`);
	};
	const restForce = async (sha, exists) => {
		if (exists) await api("PATCH", `/git/refs/heads/${targetBranch}`, { sha, force: true }, ctx);
		else await api("POST", "/git/refs", { ref: `refs/heads/${targetBranch}`, sha }, ctx);
	};

	const prCache = new Map();
	const prFor = async (commit) => {
		if (prCache.has(commit.sha)) return prCache.get(commit.sha);
		let pulls = [];
		try {
			pulls = await api("GET", `/commits/${commit.sha}/pulls`, null, ctx);
		} catch (e) {
			console.log(`⚠️  PR lookup for ${commit.sha.slice(0, 7)} failed: ${e.message}`);
		}
		const n = pickPrForCommit(pulls, { sha: commit.sha, targetBranch, subject: commit.subject });
		prCache.set(commit.sha, n);
		return n;
	};
	const resolveStuck = async (commits) => {
		const out = [];
		for (const c of commits) out.push({ sha: c.sha, subject: c.subject, pr: await prFor(c) });
		return out;
	};
	const comment = async (pr, body) => {
		if (!pr || dryRun) return;
		try {
			await api("POST", `/issues/${pr}/comments`, { body }, ctx);
		} catch (e) {
			console.log(`::warning::Could not comment on #${pr}: ${e.message}`);
		}
	};
	const openFailureIssue = async (body) => {
		if (!openIssue || dryRun) return "";
		try {
			const title = failureIssueTitle(targetBranch);
			const open = await api("GET", `/issues?state=open&per_page=100`, null, ctx);
			const existing = (open || []).find((i) => i.title === title && !i.pull_request);
			if (existing) {
				await api("POST", `/issues/${existing.number}/comments`, { body }, ctx);
				return existing.html_url;
			}
			const created = await api("POST", "/issues", { title, body }, ctx);
			return created?.html_url || "";
		} catch (e) {
			console.log(`::warning::Could not open the failure issue: ${e.message}`);
			return "";
		}
	};

	const report = {
		targetBranch,
		releaseSha,
		targetSha: "",
		resetSha: "",
		method: "",
		carried: [],
		skipped: [],
		stuck: [],
		reason: "",
		result: ""
	};
	const finish = (exitCode) => {
		appendSummary(buildSummary(report));
		setOutputs({
			"result": report.result,
			"reset-sha": report.resetSha,
			"update-method": report.method,
			"carried-count": String(report.carried.length),
			"carried": JSON.stringify(report.carried.map(({ original, carried, subject, pr }) => ({ original, carried, subject, pr })))
		});
		if (exitCode) process.exit(exitCode);
	};
	// `stuck` entries are { sha, subject, pr }; late commits are resolved to their PR here.
	const fail = async (reason, stuck, { untouched = true } = {}) => {
		report.result = report.result || "conflict";
		report.reason = reason;
		report.stuck.push(...stuck);
		console.error(`::error::${targetBranch}: ${reason}${untouched ? ` — ${targetBranch} left untouched; nothing was dropped.` : ""}`);
		const issueUrl = await openFailureIssue(
			buildFailureIssueBody({
				targetBranch,
				releaseLabel,
				releaseSha,
				targetSha: report.targetSha,
				reason,
				commits: report.stuck,
				runUrl,
				untouched
			})
		);
		for (const s of report.stuck)
			await comment(s.pr, buildStuckPrComment({ targetBranch, releaseLabel, reason, issueUrl, runUrl, untouched }));
		finish(1);
	};

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const fetched = git(cwd, [...fetchArgs, remote, `+refs/heads/${targetBranch}:refs/cldmv-reset/target`]);
		const targetExists = fetched.status === 0;
		if (!targetExists) git(cwd, ["update-ref", "-d", "refs/cldmv-reset/target"]);
		const targetSha = targetExists ? gitOk(cwd, ["rev-parse", "refs/cldmv-reset/target^{commit}"]) : "";
		if (!targetExists && (await readRemote())) throw new Error(`could not fetch ${targetBranch}: ${redact(fetched.stderr.trim())}`);
		report.targetSha = targetSha;
		if (fetchArgs.includes("--unshallow")) fetchArgs.pop();

		if (releaseHeadSha && !fetchSha(releaseHeadSha)) {
			console.log(
				`⚠️  release head ${releaseHeadSha.slice(0, 7)} is not available — late commits will be detected by replay (empty replays skipped).`
			);
			releaseHeadSha = "";
		}

		const releaseIsAncestor = !!targetSha && isAncestor(cwd, releaseSha, targetSha);
		const late = targetSha && !releaseIsAncestor ? listLateCommits({ cwd, targetSha, releaseSha, releaseHeadSha }) : [];
		const action = decideAction({ targetSha, releaseIsAncestor, candidateCount: late.length });
		console.log(
			`🔎 attempt ${attempt}/${maxAttempts}: ${targetBranch}=${targetSha.slice(0, 7) || "(missing)"} release=${releaseSha.slice(0, 7)} head=${releaseHeadSha.slice(0, 7) || "(unknown)"} late=${late.length} → ${action}`
		);
		for (const c of late) console.log(`   late: ${c.sha.slice(0, 7)} ${c.subject}`);

		if (action === "noop") {
			report.result = "noop";
			report.resetSha = targetSha;
			console.log(`✅ ${targetBranch} already contains the release — nothing to do.`);
			return finish(0);
		}

		let newSha = releaseSha;
		let carried = [];
		let skipped = [];
		if (action === "carry") {
			const plan = planReplay({ cwd, baseSha: releaseSha, commits: late });
			if (plan.conflict) {
				// Nothing is published or moved on a conflict, so EVERY late commit
				// is still only on the untouched branch — all of them are reported.
				return fail(
					`replaying ${plan.conflict.original.sha.slice(0, 7)} ("${plan.conflict.original.subject}") onto the release conflicts: ${plan.conflict.details}`,
					await resolveStuck(late)
				);
			}
			skipped = plan.steps.filter((s) => s.empty).map((s) => ({ original: s.original.sha, subject: s.original.subject }));
			if (plan.steps.every((s) => s.empty)) {
				console.log("ℹ️  every late commit is already in the release — resetting.");
			} else if (dryRun) {
				report.result = "dry-run";
				report.skipped = skipped;
				report.carried = plan.steps
					.filter((s) => !s.empty)
					.map((s) => ({ original: s.original.sha, carried: "dry-run", subject: s.original.subject, pr: null }));
				return finish(0);
			} else {
				const published = await publishReplay({
					cwd,
					baseSha: releaseSha,
					steps: plan.steps,
					messageFor: (step) =>
						buildCarriedMessage({ originalMessage: step.original.message, originalSha: step.original.sha, targetBranch, releaseLabel }),
					ctx
				});
				newSha = published.tip;
				carried = published.carried;
				for (const c of carried)
					console.log(`🔐 carried ${c.original.slice(0, 7)} → ${c.carried.slice(0, 7)} (verified: ${c.verified}) ${c.subject}`);
			}
		}

		if (dryRun) {
			report.result = "dry-run";
			report.skipped = skipped;
			console.log(`ℹ️  dry-run: would move ${targetBranch} ${targetSha.slice(0, 7) || "(missing)"} → ${newSha.slice(0, 7)}`);
			return finish(0);
		}

		const cas = await compareAndSwapRef({
			targetBranch,
			expectedSha: targetSha,
			newSha,
			allowUnleased,
			readRemote,
			graphqlCas,
			leasePush,
			restForce
		});
		for (const e of cas.errors) console.log(`⚠️  ${e}`);
		if (cas.moved) {
			console.log(
				`↻ ${targetBranch} moved during the step (${targetSha.slice(0, 7)} → ${cas.current.slice(0, 7) || "(missing)"}) — re-planning so the new commit is carried, not overwritten.`
			);
			continue;
		}
		if (!cas.ok) {
			report.result = "failed";
			return fail(`every ref-update path was refused (${cas.errors.join(" | ")})`, await resolveStuck(late));
		}

		report.method = cas.method;
		report.resetSha = newSha;
		report.skipped = skipped;
		report.result = action === "create" ? "created" : action === "carry" && carried.length > 0 ? "carried" : "reset";
		if (cas.method === "rest-unleased")
			console.log(
				`::warning::${targetBranch} was updated without a compare-and-swap (both CAS paths were refused); auditing PRs merged into it since the release.`
			);
		console.log(`✅ ${targetBranch}: ${targetSha.slice(0, 7) || "(missing)"} → ${newSha.slice(0, 7)} via ${cas.method} (${report.result})`);

		for (const c of carried) {
			const commit = late.find((l) => l.sha === c.original);
			c.pr = commit ? await prFor(commit) : null;
			report.carried.push(c);
			await comment(
				c.pr,
				buildCarriedPrComment({ targetBranch, releaseLabel, releasePr, originalSha: c.original, carriedSha: c.carried, runUrl })
			);
		}

		// Audit: every PR merged into the branch since the release must be in the
		// release, on the new tip, or among the carried originals. With a CAS
		// update this cannot fail; it is the backstop for the unleased path.
		const lost = await auditMergedPrs({
			cwd,
			ctx,
			targetBranch,
			since: releaseMergedAt,
			newSha,
			releaseHeadSha,
			carried,
			skipped,
			fetchSha,
			remote
		});
		if (lost.length > 0) {
			report.result = "lost";
			return fail(
				`PR(s) ${lost.map((p) => `#${p.number}`).join(", ")} merged into ${targetBranch} after the release but are on neither the release nor ${targetBranch}`,
				lost.map((p) => ({ sha: p.merge_commit_sha || "", subject: p.title || "", pr: p.number })),
				{ untouched: false }
			);
		}
		return finish(0);
	}

	report.result = "failed";
	return fail(`${targetBranch} kept moving during ${maxAttempts} attempts`, []);
}

/**
 * List PRs merged into the branch since `since` whose merge commit is not
 * reachable from the new tip or the release head and was not carried.
 */
async function auditMergedPrs({ cwd, ctx, targetBranch, since, newSha, releaseHeadSha, carried, skipped, fetchSha, remote }) {
	const sinceMs = since && !Number.isNaN(Date.parse(since)) ? Date.parse(since) - 120_000 : Date.now() - 30 * 60_000;
	let pulls;
	try {
		pulls = await api(
			"GET",
			`/pulls?state=closed&base=${encodeURIComponent(targetBranch)}&sort=updated&direction=desc&per_page=50`,
			null,
			ctx
		);
	} catch (e) {
		console.log(`::warning::Could not audit PRs merged into ${targetBranch}: ${e.message}`);
		return [];
	}
	// Skipped = replayed as empty, i.e. its change is already in the release.
	const carriedOriginals = new Set([...carried.map((c) => c.original), ...skipped.map((s) => s.original)]);
	// A PR may legitimately merge onto the NEW tip right after the update, so
	// reachability is checked against the branch as it is now, too.
	const now = git(cwd, ["fetch", "--no-tags", "--quiet", remote, `+refs/heads/${targetBranch}:refs/cldmv-reset/audit`]);
	const currentTip = now.status === 0 ? git(cwd, ["rev-parse", "refs/cldmv-reset/audit"]).stdout.trim() : "";
	const lost = [];
	for (const p of pulls || []) {
		if (!p.merged_at || Date.parse(p.merged_at) < sinceMs || !p.merge_commit_sha) continue;
		const m = p.merge_commit_sha;
		if (carriedOriginals.has(m)) continue;
		if (!fetchSha(m)) {
			lost.push(p);
			continue;
		}
		if (
			isAncestor(cwd, m, newSha) ||
			(currentTip && isAncestor(cwd, m, currentTip)) ||
			(releaseHeadSha && isAncestor(cwd, m, releaseHeadSha))
		)
			continue;
		lost.push(p);
	}
	return lost;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`::error::${redact(error.message)}`);
		process.exit(1);
	});
}
