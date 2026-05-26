/**
 * @fileoverview Redirect a PR's base branch to the hotfix lane when either:
 *   - The head branch matches the hotfix/security pattern (existing behavior,
 *     §6.5 of the v4 design — docs/conventions/release-flow-v4.md), OR
 *   - The PR is a Dependabot **security** update (author = dependabot[bot]
 *     AND body references a GHSA advisory). Dependabot routine bumps still
 *     skip; only security PRs are redirected.
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
 * Detect a Dependabot security-advisory PR. Dependabot includes references
 * to the relevant GHSA advisory in the PR body — either as a literal GHSA-id
 * token or as a link to `github.com/advisories/GHSA-…`. Routine version bumps
 * never include those references, so body-content inspection reliably
 * distinguishes the two.
 *
 * @public
 * @param {object} opts
 * @param {string} opts.userLogin - PR author's login (e.g. "dependabot[bot]")
 * @param {string} opts.prBody - PR body / description text
 * @returns {boolean}
 */
export function isDependabotSecurityPR({ userLogin, prBody }) {
	if (userLogin !== "dependabot[bot]") return false;
	if (!prBody) return false;
	const ghsaId = /\bGHSA-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}\b/;
	const advisoryUrl = /\bhttps?:\/\/github\.com\/advisories\/GHSA-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}\b/i;
	return ghsaId.test(prBody) || advisoryUrl.test(prBody);
}

/**
 * Decide whether to skip redirection. Returns { skip, reason, redirectKind }
 * where redirectKind is "hotfix" or "dependabot-security" when skip=false,
 * indicating *why* the PR is being redirected (used to pick the right
 * explanatory comment).
 *
 * @public
 */
export function shouldSkip({ userType, userLogin, headRef, baseRef, targetBase, headPattern, prBody }) {
	// Dependabot security PRs override the usual bot-skip rule.
	if (isDependabotSecurityPR({ userLogin, prBody })) {
		if (baseRef === targetBase) {
			return { skip: true, reason: `PR already targets '${targetBase}'`, redirectKind: null };
		}
		return { skip: false, reason: "", redirectKind: "dependabot-security" };
	}
	if (userType === "Bot") return { skip: true, reason: "PR author is a Bot", redirectKind: null };
	if (!headRef || !headPattern.test(headRef)) {
		return { skip: true, reason: `Head '${headRef}' does not match hotfix pattern ${headPattern}`, redirectKind: null };
	}
	if (baseRef === targetBase) {
		return { skip: true, reason: `PR already targets '${targetBase}'`, redirectKind: null };
	}
	return { skip: false, reason: "", redirectKind: "hotfix" };
}

/**
 * Build the explanatory comment body. `kind` selects the reason text:
 *   - "hotfix" (default): head branch matched the hotfix pattern.
 *   - "dependabot-security": PR is a Dependabot security advisory update.
 *
 * @public
 */
export function buildCommentBody(oldBase, newBase, kind = "hotfix") {
	if (kind === "dependabot-security") {
		return `${COMMENT_SENTINEL} retargeted this Dependabot PR from \`${oldBase}\` to \`${newBase}\` because it references a security advisory (GHSA). Security updates ship via the hotfix lane.\n\nIf this was misclassified, change the base back via the **Edit** button on the PR title — this workflow won't re-fire on subsequent edits.`;
	}
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
	const targetBase = getInput("target-base") || "hotfixes";
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
	const userLogin = pr?.user?.login || "";
	const prBody = pr?.body || "";

	const skip = shouldSkip({ userType, userLogin, headRef, baseRef, targetBase, headPattern, prBody });
	if (skip.skip) {
		console.log(`⏭️  Skipped: ${skip.reason}`);
		setOutputs({ redirected: "false", "new-base": baseRef, skipped: "true", "skip-reason": skip.reason });
		return;
	}

	const reasonLabel = skip.redirectKind === "dependabot-security" ? "Dependabot security advisory" : "hotfix branch";
	console.log(`🔀 Redirecting PR #${prNumber} base: ${baseRef} → ${targetBase} (${reasonLabel})`);

	if (dryRun) {
		console.log("ℹ️  dry-run=true — skipping PATCH + comment.");
		setOutputs({ redirected: "false", "new-base": targetBase, skipped: "false", "skip-reason": "dry-run" });
		return;
	}

	await patchBase(owner, repo, prNumber, targetBase, token);

	if (!(await hasSentinelComment(owner, repo, prNumber, token))) {
		await postComment(owner, repo, prNumber, buildCommentBody(baseRef, targetBase, skip.redirectKind), token);
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
