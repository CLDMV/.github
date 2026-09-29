/**
 * @fileoverview Move issues resolved by work that just landed on an
 * integration branch (`next`/`hotfixes`) to the `status: implemented` label.
 *
 * Why this exists: in the v4 staging-branch flow an issue's fix merges into
 * `next`/`hotfixes` long before it ships. close-resolved-issues closes the
 * issue once the release reaches the default branch; until then nothing on the
 * issue says the work is done, so it reads as still open and unstarted. This
 * action fills that gap at merge time: the issue stays OPEN (the release closes
 * it) but its status label moves to `status: implemented` — "built, not yet
 * shipped/verified", per data/github-labels.json.
 *
 * What it does:
 *   1. List the pushed range `before...after`, minus every commit already
 *      reachable from the release base (`base...after`). The exclusion keeps a
 *      hotfix-release master→next sync, or a reset, from re-marking shipped
 *      work.
 *   2. Source PRs = the trailing `(#N)` on each commit subject in that range
 *      (the merge/squash commit GitHub writes per PR), falling back to the
 *      commit→PR association of the head commit when no subject carries one.
 *   3. Sweep each source PR's description, comments, and constituent commits
 *      for `Fixes/Closes/Resolves #N` keywords and `gh-broker:resolves:`
 *      markers (attributed to that PR), then every commit message in the range
 *      itself (covers direct pushes with no PR).
 *   4. For each referenced open issue: skip when it already carries the target
 *      label or is `status: verified`; otherwise drop its other `status:`
 *      labels, add the target label, and comment with the resolving PR.
 *
 * Best-effort per issue: one issue's failure is logged and skipped.
 *
 * @module @cldmv/.github.github.steps.mark-implemented-issues
 */

import { api, paginate, parseRepo } from "../../api/_api/core.mjs";
import { getInput, setOutput } from "../../../common/common/core.mjs";
import {
	extractMergedPRRefs,
	extractResolvesMarkers,
	extractCloseKeywords,
	sourcePRTexts,
	pickReleasePR,
	listRangeCommits
} from "../close-resolved-issues/action.mjs";

const ZERO_SHA_RE = /^0+$/;
const STATUS_PREFIX = "status:";
const VERIFIED_LABEL = "status: verified";

/**
 * The unreleased commits (`base...after`) that this push introduced
 * (`before...after`), matched by sha. Pure.
 * @public
 */
export function unreleasedInPush(unreleased, pushed) {
	const inPush = new Set((pushed || []).map((c) => c?.sha).filter(Boolean));
	return (unreleased || []).filter((c) => c?.sha && inPush.has(c.sha));
}

/**
 * Every `(#N)` PR ref on the subjects of `commits`, in first-seen order. Pure.
 * @public
 */
export function sourcePRsFromCommits(commits) {
	const found = new Set();
	for (const c of commits || []) {
		const subject = (c?.commit?.message || "").split("\n", 1)[0];
		for (const n of extractMergedPRRefs(subject)) found.add(n);
	}
	return [...found];
}

/**
 * From a commit's associated PRs, the one merged INTO `branch` (most recent
 * merge wins). Never the open `branch → master` release PR, which is also
 * associated with every commit on `branch`. Pure.
 * @public
 */
export function pickMergedInto(prs, branch) {
	return pickReleasePR((Array.isArray(prs) ? prs : []).filter((p) => p?.merged_at && p?.base?.ref === branch));
}

/**
 * Decide what to do with one issue's labels. Returns `{ skip, reason }` when
 * nothing should change, else `{ skip: false, remove }` — the other `status:`
 * labels to drop before adding `target`. Status is single-valued in the org
 * taxonomy, so every other `status:` label goes; `status: verified` is a LATER
 * lifecycle stage and is never downgraded. Pure.
 * @public
 */
export function planLabelChange(labels, target) {
	const names = (labels || []).map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);
	const lower = (s) => s.toLowerCase();
	if (names.some((n) => lower(n) === lower(target))) return { skip: true, reason: `already labeled "${target}"` };
	if (names.some((n) => lower(n) === VERIFIED_LABEL)) return { skip: true, reason: `already "${VERIFIED_LABEL}"` };
	const remove = names.filter((n) => lower(n).startsWith(STATUS_PREFIX));
	return { skip: false, remove };
}

/**
 * The comment posted on a marked issue. Pure.
 * @public
 */
export function implementedComment({ label, source, branch }) {
	const by = typeof source === "number" ? `#${source}` : source ? `\`${String(source).slice(0, 7)}\`` : "a commit";
	return `Marked \`${label}\` — resolved by ${by}, merged into \`${branch}\`. This issue closes automatically when that work ships to the default branch.`;
}

/** Add every number `extract(text)` finds to `map`, keeping the first source seen per issue. */
function collectInto(map, extract, text, source) {
	for (const n of extract(text)) {
		if (!map.has(n)) map.set(n, source);
	}
}

/** Create `name` in the repo when it's missing (org label sync may not have run yet). */
async function ensureLabel(name, color, ctx) {
	try {
		await api("GET", `/labels/${encodeURIComponent(name)}`, null, ctx);
	} catch (err) {
		if (!/-> 404:/.test(err.message)) throw err;
		console.log(`🏷️ Label "${name}" missing — creating it.`);
		await api("POST", "/labels", { name, color }, ctx);
	}
}

async function main() {
	const token = getInput("github-token", { required: true });
	const baseBranch = getInput("base-branch", { required: true });
	const label = getInput("label") || "status: implemented";
	const labelColor = getInput("label-color") || "1d76db";
	const after = getInput("after") || process.env.GITHUB_SHA;
	const before = getInput("before");
	const branch = getInput("branch") || process.env.GITHUB_REF_NAME || "next";
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);
	const ctx = { token, owner, repo };

	if (!after) throw new Error("No head SHA — pass `after` or run where GITHUB_SHA is set.");

	// Everything on `after` not yet on the base branch. The pushed range is
	// narrowed to that set, so commits that arrived via a master→next sync (a
	// hotfix release) or were already released never count.
	const unreleased = await listRangeCommits(owner, repo, baseBranch, after, token);
	let commits = unreleased;
	if (before && !ZERO_SHA_RE.test(before)) {
		commits = unreleasedInPush(unreleased, await listRangeCommits(owner, repo, before, after, token));
	}
	console.log(`📋 ${commits.length} unreleased commit(s) in this push (${before ? before.slice(0, 7) : "<new>"}..${after.slice(0, 7)}).`);
	if (commits.length === 0) {
		setOutput("marked", "");
		return;
	}

	let sourcePRs = sourcePRsFromCommits(commits);
	if (sourcePRs.length === 0) {
		try {
			const pr = pickMergedInto(await api("GET", `/commits/${encodeURIComponent(after)}/pulls`, null, ctx), branch);
			if (pr) sourcePRs = [pr];
		} catch (err) {
			console.log(`⚠️ commit→PR lookup for ${after.slice(0, 7)} failed: ${err.message}`);
		}
	}
	console.log(`🔗 Source PR(s): ${sourcePRs.map((n) => `#${n}`).join(", ") || "<none>"}`);

	// issue number -> resolving PR number (or commit sha for a PR-less push)
	const issueSources = new Map();
	for (const sourcePR of sourcePRs) {
		try {
			const [prData, comments, prCommits] = await Promise.all([
				api("GET", `/pulls/${sourcePR}`, null, ctx),
				paginate(`/issues/${sourcePR}/comments`, ctx),
				paginate(`/pulls/${sourcePR}/commits`, ctx)
			]);
			for (const text of sourcePRTexts({ body: prData?.body, comments: comments.items, commits: prCommits.items })) {
				collectInto(issueSources, extractResolvesMarkers, text, sourcePR);
				collectInto(issueSources, extractCloseKeywords, text, sourcePR);
			}
		} catch (err) {
			console.log(`⚠️ Could not read PR #${sourcePR} (description/comments/commits): ${err.message}`);
		}
	}
	// Commit messages in the range — catches direct pushes that carry a keyword
	// with no PR behind them. PR-attributed hits above win (first source kept).
	for (const c of commits) {
		const message = c?.commit?.message || "";
		const subjectPRs = [...extractMergedPRRefs(message.split("\n", 1)[0])];
		const source = subjectPRs.length ? subjectPRs[subjectPRs.length - 1] : sourcePRs.length === 1 ? sourcePRs[0] : c.sha;
		collectInto(issueSources, extractCloseKeywords, message, source);
		collectInto(issueSources, extractResolvesMarkers, message, source);
	}
	console.log(`🎯 Candidate issue(s): ${[...issueSources.keys()].map((n) => `#${n}`).join(", ") || "<none>"}`);
	if (issueSources.size === 0) {
		setOutput("marked", "");
		return;
	}

	await ensureLabel(label, labelColor, ctx);

	const marked = [];
	for (const [issueNumber, source] of [...issueSources.entries()].sort((a, b) => a[0] - b[0])) {
		try {
			const issue = await api("GET", `/issues/${issueNumber}`, null, ctx);
			if (issue?.pull_request) {
				console.log(`⏭️ #${issueNumber} is a pull request — skipping.`);
				continue;
			}
			if (!issue || issue.state !== "open") {
				console.log(`⏭️ #${issueNumber} already ${issue?.state || "missing"} — skipping.`);
				continue;
			}
			const plan = planLabelChange(issue.labels, label);
			if (plan.skip) {
				console.log(`⏭️ #${issueNumber} ${plan.reason} — skipping.`);
				continue;
			}
			for (const name of plan.remove) {
				await api("DELETE", `/issues/${issueNumber}/labels/${encodeURIComponent(name)}`, null, ctx);
			}
			await api("POST", `/issues/${issueNumber}/labels`, { labels: [label] }, ctx);
			await api("POST", `/issues/${issueNumber}/comments`, { body: implementedComment({ label, source, branch }) }, ctx);
			marked.push(issueNumber);
			console.log(
				`✅ #${issueNumber} → "${label}"${plan.remove.length ? ` (removed ${plan.remove.map((n) => `"${n}"`).join(", ")})` : ""}.`
			);
		} catch (err) {
			console.log(`⚠️ Could not mark #${issueNumber}: ${err.message}`);
		}
	}

	console.log(`✅ Marked ${marked.length} issue(s): ${marked.map((n) => `#${n}`).join(", ") || "<none>"}.`);
	setOutput("marked", marked.join(","));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(`::error::${err.message}`);
		process.exit(1);
	});
}
