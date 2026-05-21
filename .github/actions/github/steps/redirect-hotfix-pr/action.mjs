/**
 * @fileoverview Redirect a PR's base branch to the hotfix lane when the head
 * branch matches the hotfix/security pattern. Implements §6.5 of the v4
 * design (docs/conventions/release-flow-v4.md).
 *
 * Pure logic functions are exported for test.mjs. Side-effecting main is
 * gated to script-entry only.
 *
 * @module @cldmv/.github.github.steps.redirect-hotfix-pr
 */

import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput, setOutputs, getBooleanInput } from "../../../common/common/core.mjs";

export const COMMENT_SENTINEL = "_Auto-redirected PR base:_";

/**
 * Compile the head-branch pattern. Accepts a regex source string; returns
 * a RegExp anchored at the start of the ref.
 *
 * @public
 */
export function compilePattern(source) {
	const src = (source || "").trim() || "^(hotfix|security)/";
	return new RegExp(src);
}

/**
 * Decide whether to skip redirection. Skip when:
 *   1. Author is a Bot.
 *   2. Head ref doesn't match the hotfix-branch pattern.
 *   3. Base ref already equals the target.
 *
 * @public
 */
export function shouldSkip({ userType, headRef, baseRef, targetBase, headPattern }) {
	if (userType === "Bot") return { skip: true, reason: "PR author is a Bot" };
	if (!headRef || !headPattern.test(headRef)) {
		return { skip: true, reason: `Head '${headRef}' does not match hotfix pattern ${headPattern}` };
	}
	if (baseRef === targetBase) {
		return { skip: true, reason: `PR already targets '${targetBase}'` };
	}
	return { skip: false, reason: "" };
}

/**
 * Build the explanatory comment body. Uses the COMMENT_SENTINEL prefix so
 * future runs can detect a prior post.
 *
 * @public
 */
export function buildCommentBody(oldBase, newBase) {
	return `${COMMENT_SENTINEL} retargeted this PR from \`${oldBase}\` to \`${newBase}\` because the head branch looks like a hotfix.\n\nIf this was not what you wanted, change the base back via the **Edit** button on the PR title — this workflow won't re-fire on subsequent edits.`;
}

// ---- side-effecting main flow (gated to script entry only) ----------------

async function fetchPR(owner, repo, prNumber, token) {
	return api("GET", `/pulls/${prNumber}`, null, { token, owner, repo });
}

async function patchBase(owner, repo, prNumber, newBase, token) {
	return api("PATCH", `/pulls/${prNumber}`, { base: newBase }, { token, owner, repo });
}

async function hasSentinelComment(owner, repo, prNumber, token) {
	const comments = await api("GET", `/issues/${prNumber}/comments?per_page=100`, null, { token, owner, repo });
	return (comments || []).some((c) => typeof c?.body === "string" && c.body.includes(COMMENT_SENTINEL));
}

async function postComment(owner, repo, prNumber, body, token) {
	return api("POST", `/issues/${prNumber}/comments`, { body }, { token, owner, repo });
}

async function main() {
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const prNumber = getInput("pr-number", { required: true });
	const targetBase = getInput("target-base") || "hotfix";
	const headPattern = compilePattern(getInput("hotfix-branch-pattern"));
	const dryRun = getBooleanInput("dry-run", false);
	let headRef = getInput("head-ref");
	let baseRef = getInput("base-ref");
	let userType = getInput("user-type");
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	const pr = await fetchPR(owner, repo, prNumber, token);
	if (!headRef) headRef = pr?.head?.ref || "";
	if (!baseRef) baseRef = pr?.base?.ref || "";
	if (!userType) userType = pr?.user?.type || "";

	const skip = shouldSkip({ userType, headRef, baseRef, targetBase, headPattern });
	if (skip.skip) {
		console.log(`⏭️  Skipped: ${skip.reason}`);
		setOutputs({ redirected: "false", "new-base": baseRef, skipped: "true", "skip-reason": skip.reason });
		return;
	}

	console.log(`🔀 Redirecting PR #${prNumber} base: ${baseRef} → ${targetBase}`);

	if (dryRun) {
		console.log("ℹ️  dry-run=true — skipping PATCH + comment.");
		setOutputs({ redirected: "false", "new-base": targetBase, skipped: "false", "skip-reason": "dry-run" });
		return;
	}

	await patchBase(owner, repo, prNumber, targetBase, token);

	if (!(await hasSentinelComment(owner, repo, prNumber, token))) {
		await postComment(owner, repo, prNumber, buildCommentBody(baseRef, targetBase), token);
		console.log("💬 Posted explanatory comment (first time).");
	} else {
		console.log("💬 Sentinel comment already present — skipping comment post.");
	}

	setOutputs({ redirected: "true", "new-base": targetBase, skipped: "false", "skip-reason": "" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}
