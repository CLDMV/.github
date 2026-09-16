/**
 * @fileoverview Approval-triggered API squash-merge for the persistent release
 * PR (`next → master`, `hotfixes → master`). Unlike native auto-merge, this
 * merges via `PUT /pulls/{n}/merge` with an EXPLICIT commit message = the PR
 * body, so:
 *   - the squash commit is exactly the curated body (no mobile Default-path
 *     title-only drop, and no GitHub UI co-author auto-append — the clean
 *     `<!-- co-authors -->` block in the body is the whole credit); and
 *   - it succeeds precisely when the PR is mergeable, instead of failing on
 *     GitHub's native auto-merge "clean status" refusal.
 *
 * It does NOT approve as the bot — the maintainer's approval is the gate. It
 * merges only when EVERY check on the head (required AND non-required — e.g.
 * the coverage badge and the release-PR body refresh) has finished and passed,
 * so the body it reads for the commit message is never stale. Fires on the
 * approval and re-evaluates on each check-suite completion, so an approval given
 * before CI is green still merges once the last check goes green. See #303.
 *
 * @module @cldmv/.github.github.jobs.release-merge
 */

import { getInput, appendSummary, setOutputs } from "../../../common/common/core.mjs";
import { api } from "../../api/_api/core.mjs";

/** Parse a comma-separated input into a lowercased Set (values trimmed, blanks dropped). */
function csvSet(input, fallback) {
	return new Set(
		(input || fallback || "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
	);
}

/**
 * Whether a PR is THE release PR: an integration branch (`next`/`hotfixes`)
 * merging into a release base branch (`master`/`main`).
 * @param {object} pr - PR object (needs head.ref / base.ref).
 * @param {{integrationBranches: Set<string>, releaseBaseBranches: Set<string>}} opts
 * @returns {boolean}
 */
export function isReleasePr(pr, { integrationBranches, releaseBaseBranches }) {
	const head = pr?.head?.ref;
	const base = pr?.base?.ref;
	return !!head && !!base && integrationBranches.has(head) && releaseBaseBranches.has(base);
}

/**
 * Reduce a PR's reviews to whether an un-superseded approval is present. The
 * latest non-COMMENTED/PENDING review per reviewer is that reviewer's standing;
 * any CHANGES_REQUESTED still standing blocks. When `requireAssociation` is on,
 * only approvals from `allowedAssociations` count.
 * @param {Array<{user?: {login?: string}, state?: string, author_association?: string}>} reviews - Chronological (`GET /pulls/{n}/reviews` order).
 * @param {{allowedAssociations: Set<string>, requireAssociation?: boolean}} opts
 * @returns {boolean}
 */
export function latestApprovalPresent(reviews, { allowedAssociations, requireAssociation = true }) {
	const standing = new Map();
	for (const r of reviews || []) {
		const login = r?.user?.login;
		if (!login) continue;
		const state = r.state;
		// COMMENTED / PENDING don't change a reviewer's approval standing.
		if (state === "COMMENTED" || state === "PENDING") continue;
		standing.set(login.toLowerCase(), { state, assoc: r.author_association });
	}
	let approved = false;
	for (const { state, assoc } of standing.values()) {
		if (state === "CHANGES_REQUESTED" || state === "DISMISSED") {
			if (state === "CHANGES_REQUESTED") return false; // an outstanding change request blocks
			continue;
		}
		if (state === "APPROVED" && (!requireAssociation || allowedAssociations.has(assoc))) approved = true;
	}
	return approved;
}

/**
 * Evaluate the FULL check set on the head — check-runs and legacy commit
 * statuses, required and non-required alike — excluding this workflow's own
 * run. Returns "pending" while anything is unfinished, "failed" if anything
 * concluded badly (outside the allow-list), else "passed".
 * @param {Array<{name?: string, status?: string, conclusion?: string}>} checkRuns
 * @param {Array<{context?: string, state?: string}>} statuses - `.statuses` from `/commits/{sha}/status` (legacy); ignored when empty.
 * @param {{selfPattern?: string, allowFailing?: Set<string>}} opts
 * @returns {{state: "pending"|"failed"|"passed", pending: string[], failed: string[]}}
 */
export function evaluateChecks(checkRuns, statuses, { selfPattern = "", allowFailing = new Set() }) {
	const pending = [];
	const failed = [];
	const isSelf = (name) => !!selfPattern && !!name && name.includes(selfPattern);
	const okConclusion = new Set(["success", "neutral", "skipped"]);

	for (const cr of checkRuns || []) {
		if (isSelf(cr.name)) continue;
		if (cr.status !== "completed") {
			pending.push(cr.name || "(unnamed check)");
			continue;
		}
		if (!okConclusion.has(cr.conclusion) && !allowFailing.has(cr.name)) {
			failed.push(`${cr.name || "(unnamed check)"} (${cr.conclusion})`);
		}
	}
	for (const s of statuses || []) {
		if (isSelf(s.context)) continue;
		if (s.state === "pending") {
			pending.push(s.context || "(unnamed status)");
			continue;
		}
		if (s.state !== "success" && !allowFailing.has(s.context)) {
			failed.push(`${s.context || "(unnamed status)"} (${s.state})`);
		}
	}

	if (failed.length) return { state: "failed", pending, failed };
	if (pending.length) return { state: "pending", pending, failed };
	return { state: "passed", pending, failed };
}

/** All check-runs for a ref, following pagination (the response wraps them in `check_runs`). */
async function listCheckRuns(sha, { token, owner, repo }) {
	const out = [];
	for (let page = 1; page <= 20; page++) {
		const res = await api("GET", `/commits/${sha}/check-runs?per_page=100&page=${page}`, null, { token, owner, repo });
		const batch = res?.check_runs || [];
		out.push(...batch);
		if (batch.length < 100) break;
	}
	return out;
}

/**
 * Resolve the release PR number to act on. Event fields arrive as inputs from
 * the workflow's `github` context — we deliberately do NOT read
 * GITHUB_EVENT_PATH, since flowing event-file data into the outbound API calls
 * is what CodeQL flags as js/file-access-to-http. `prNumberInput` is set on a
 * pull_request_review, `headBranchInput` on a check_suite; otherwise
 * (workflow_dispatch, or neither field) fall back to scanning open PRs for the
 * single release PR. Returns null when none matches.
 * @returns {Promise<number|null>}
 */
async function resolveReleasePr({ prNumberInput, headBranchInput, integrationBranches, releaseBaseBranches, token, owner, repo }) {
	// 1. Direct PR number (pull_request_review).
	if (prNumberInput && /^\d+$/.test(prNumberInput)) return Number(prNumberInput);
	// 2. Head branch (check_suite) → its open PR into a release base.
	if (headBranchInput && integrationBranches.has(headBranchInput)) {
		const prs = await api("GET", `/pulls?head=${owner}:${headBranchInput}&state=open`, null, { token, owner, repo });
		const match = (prs || []).find((p) => releaseBaseBranches.has(p.base?.ref));
		if (match) return match.number;
	}
	// 3. Fallback (workflow_dispatch / neither field): the single open release PR
	//    — an integration branch open against a release base.
	for (const base of releaseBaseBranches) {
		const prs = await api("GET", `/pulls?base=${base}&state=open`, null, { token, owner, repo });
		const match = (prs || []).find((p) => integrationBranches.has(p.head?.ref));
		if (match) return match.number;
	}
	return null;
}

async function main() {
	const token = getInput("github_token", { required: true });
	const releaseBaseBranches = csvSet(getInput("release_base_branches"), "master,main");
	const integrationBranches = csvSet(getInput("integration_branches"), "next,hotfixes");
	const allowedAssociations = csvSet(getInput("allowed_associations"), "MEMBER,OWNER");
	const requireApproval = (getInput("require_approval") || "true").toLowerCase() === "true";
	const mergeMethod = (getInput("merge_method") || "squash").toLowerCase();
	const allowFailing = csvSet(getInput("allow_failing_checks"), "");
	const selfPattern = getInput("self_check_pattern") || process.env.GITHUB_WORKFLOW || "";
	// Event fields, passed by the workflow from its `github` context — never read
	// from GITHUB_EVENT_PATH (that flows file data into the API calls → CodeQL
	// js/file-access-to-http). Empty when the triggering event lacks the field.
	const prNumberInput = getInput("pr_number");
	const headBranchInput = getInput("head_branch");

	const [owner, repo] = (process.env.GITHUB_REPOSITORY || "").split("/");
	if (!owner || !repo) throw new Error("GITHUB_REPOSITORY not set");

	const prNumber = await resolveReleasePr({ prNumberInput, headBranchInput, integrationBranches, releaseBaseBranches, token, owner, repo });
	if (!prNumber) {
		console.log("ℹ️ No release PR associated with this event; skipping.");
		setOutputs({ merged: "false", "pr-number": "" });
		return;
	}

	// Always re-fetch fresh: the event payload can be stale, and we need the
	// current title/body (for the commit message), head SHA, and merge state.
	const pr = await api("GET", `/pulls/${prNumber}`, null, { token, owner, repo });

	if (!isReleasePr(pr, { integrationBranches, releaseBaseBranches })) {
		console.log(`ℹ️ PR #${prNumber} (${pr.head?.ref} → ${pr.base?.ref}) is not a release PR; skipping.`);
		setOutputs({ merged: "false", "pr-number": String(prNumber) });
		return;
	}
	if (pr.merged || pr.state !== "open") {
		console.log(`ℹ️ PR #${prNumber} is already ${pr.merged ? "merged" : pr.state}; nothing to do.`);
		setOutputs({ merged: pr.merged ? "true" : "false", "pr-number": String(prNumber) });
		return;
	}
	if (pr.draft) {
		console.log(`ℹ️ PR #${prNumber} is a draft; skipping.`);
		setOutputs({ merged: "false", "pr-number": String(prNumber) });
		return;
	}

	// Gate 1 — an un-superseded human approval must be present.
	if (requireApproval) {
		const reviews = await api("GET", `/pulls/${prNumber}/reviews?per_page=100`, null, { token, owner, repo });
		if (!latestApprovalPresent(reviews, { allowedAssociations })) {
			console.log(`⏳ PR #${prNumber} has no standing approval from ${[...allowedAssociations].join("/")}; waiting.`);
			setOutputs({ merged: "false", "pr-number": String(prNumber) });
			return;
		}
	}

	// Gate 2 — the FULL check set (required + non-required) must be finished and green.
	const headSha = pr.head.sha;
	const [checkRuns, statusResp] = await Promise.all([
		listCheckRuns(headSha, { token, owner, repo }),
		api("GET", `/commits/${headSha}/status`, null, { token, owner, repo })
	]);
	const verdict = evaluateChecks(checkRuns, statusResp?.statuses || [], { selfPattern, allowFailing });
	if (verdict.state === "pending") {
		console.log(`⏳ PR #${prNumber}: waiting on ${verdict.pending.length} unfinished check(s): ${verdict.pending.join(", ")}`);
		setOutputs({ merged: "false", "pr-number": String(prNumber) });
		return;
	}
	if (verdict.state === "failed") {
		console.log(`🛑 PR #${prNumber}: not merging — failing check(s): ${verdict.failed.join(", ")}`);
		appendSummary(`🛑 Release PR #${prNumber} not merged — failing checks: ${verdict.failed.join(", ")}`);
		setOutputs({ merged: "false", "pr-number": String(prNumber) });
		return;
	}

	// All gates passed — squash-merge via the API with the EXPLICIT body so the
	// commit is exactly the curated PR body (no title-only drop, no UI co-author
	// auto-append). `sha` pins the merge to the head we just gated.
	console.log(`🚀 PR #${prNumber}: approved + all checks green — squash-merging with the PR body as the commit message.`);
	try {
		await api(
			"PUT",
			`/pulls/${prNumber}/merge`,
			{ merge_method: mergeMethod, sha: headSha, commit_title: pr.title, commit_message: pr.body || "" },
			{ token, owner, repo }
		);
	} catch (err) {
		// 409 = head moved since we read it; a later check-suite/review event
		// re-fires and re-gates the new head. Benign — don't fail the run.
		if (/->\s*409:/.test(err.message) || /Head branch was modified/i.test(err.message)) {
			console.log(`ℹ️ PR #${prNumber} head moved during merge; will re-evaluate on the next event.`);
			setOutputs({ merged: "false", "pr-number": String(prNumber) });
			return;
		}
		throw err;
	}

	console.log(`✅ Merged release PR #${prNumber}.`);
	appendSummary(`✅ **Release PR #${prNumber} squash-merged** with the curated PR body as the commit message.`);
	setOutputs({ merged: "true", "pr-number": String(prNumber) });
}

// Only run when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}
