/**
 * @fileoverview Shared "approve + enable auto-merge" flow: parse the semver
 * bump from a PR title, verify the base branch has CI gating, approve the PR
 * as the bot, and enable auto-merge via GraphQL (falling back to a direct
 * merge when the PR is already mergeable). Factored out of
 * dependabot-auto-merge/action.mjs so redirect-hotfix-pr can drive the same
 * zero-touch flow for the replacement PR it opens against `hotfixes`.
 * @module @cldmv/.github.github.api._api.auto-merge
 */

import { api } from "./core.mjs";
import {
	parseSemverBump,
	requiredCheckContextsFromRules,
	isNotFoundError,
	allowedMergeMethodsFromRules,
	chooseMergeMethod,
	isAlreadyMergeableError
} from "../../jobs/dependabot-auto-merge/_impl.mjs";

/** GraphQL helper for enablePullRequestAutoMerge (REST has no equivalent). */
async function graphql(token, query, variables) {
	const res = await fetch("https://api.github.com/graphql", {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${token}`,
			"Accept": "application/vnd.github+json",
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ query, variables })
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GraphQL ${res.status}: ${text}`);
	}
	const result = await res.json();
	if (result.errors?.length) {
		throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
	}
	return result.data;
}

/**
 * Approve a PR and enable (or perform) its merge, gated by the same rules
 * dependabot-auto-merge always enforced: a parseable semver bump in the
 * allowed list, and — unless explicitly disabled — required-status-checks
 * on the base branch (an approval-only rule is not sufficient, since this
 * function's own approval would satisfy it).
 *
 * Returns a discriminated result instead of calling process.exit, so both
 * the standalone action and redirect-hotfix-pr's replacement-PR flow can
 * decide their own logging/exit behavior.
 *
 * @public
 * @param {object} opts
 * @param {string} opts.token
 * @param {string} opts.owner
 * @param {string} opts.repo
 * @param {number} opts.prNumber
 * @param {string} opts.prTitle
 * @param {string} opts.prNodeId
 * @param {string} opts.headSha
 * @param {string} opts.baseRef
 * @param {string[]} [opts.bumpTypes] - Allowed bump types. Default patch+minor.
 * @param {string} [opts.mergeMethod] - Preferred method; narrowed to what the ruleset allows.
 * @param {boolean} [opts.requireBranchProtection] - Refuse if the base has no required checks. Default true.
 * @param {string} [opts.approveBody] - Override the approval review body.
 * @returns {Promise<{outcome: "skipped", reason: string, bump?: object} |
 *   {outcome: "auto-merge-enabled"|"merged-directly", bump: object, mergeMethod: string}>}
 */
export async function approveAndEnableAutoMerge({
	token,
	owner,
	repo,
	prNumber,
	prTitle,
	prNodeId,
	headSha,
	baseRef,
	bumpTypes = ["patch", "minor"],
	mergeMethod: mergeMethodInput = "merge",
	requireBranchProtection = true,
	approveBody
}) {
	const bump = parseSemverBump(prTitle);
	if (!bump) {
		return { outcome: "skipped", reason: `Could not parse bump type from title: "${prTitle}"` };
	}
	if (!bumpTypes.includes(bump.type)) {
		return { outcome: "skipped", reason: `Bump type "${bump.type}" not in allowed list (${bumpTypes.join(", ")})`, bump };
	}

	let allowedMerge = [];
	if (requireBranchProtection) {
		let rules;
		try {
			rules = await api("GET", `/rules/branches/${encodeURIComponent(baseRef)}`, null, { token, owner, repo });
		} catch (err) {
			if (isNotFoundError(err.message)) {
				throw new Error(
					`Base branch "${baseRef}" has no effective branch rules (classic protection and rulesets both empty). Refusing to enable auto-merge — this would merge without CI gating. Add a ruleset / branch-protection rule or set require_branch_protection: false to override.`
				);
			}
			throw new Error(
				`Could not read branch rules for "${baseRef}" (${err.message}). Refusing to enable auto-merge — protection state is unknown. Ensure the token has "Administration: read" (repository rules) on the repo, or set require_branch_protection: false to override.`
			);
		}

		const requiredCheckContexts = requiredCheckContextsFromRules(rules);
		if (requiredCheckContexts.length === 0) {
			throw new Error(
				`Base branch "${baseRef}" has no effective required status checks (checked classic protection + rulesets). Refusing to enable auto-merge — without CI gating it would merge immediately, and the bot's own approval satisfies any approval-only rule. Add a required-status-checks ruleset / branch protection, or set require_branch_protection: false to override.`
			);
		}
		allowedMerge = allowedMergeMethodsFromRules(rules);
	}

	const mergeMethod = chooseMergeMethod(mergeMethodInput, allowedMerge);

	await api(
		"POST",
		`/pulls/${prNumber}/reviews`,
		{ event: "APPROVE", body: approveBody || `Auto-approved by CLDMV-bot: ${bump.type} bump from ${bump.from} to ${bump.to}.` },
		{ token, owner, repo }
	);

	const mutation = `
		mutation EnableAutoMerge($prId: ID!, $method: PullRequestMergeMethod!) {
			enablePullRequestAutoMerge(input: { pullRequestId: $prId, mergeMethod: $method }) {
				pullRequest { autoMergeRequest { enabledAt } }
			}
		}
	`;
	try {
		await graphql(token, mutation, { prId: prNodeId, method: mergeMethod.toUpperCase() });
		return { outcome: "auto-merge-enabled", bump, mergeMethod };
	} catch (autoMergeError) {
		// Only fall back to a direct merge when auto-merge couldn't queue *because
		// the PR is already mergeable* (GitHub: "clean"/"unstable status"). Any
		// other failure must surface, not trigger a merge.
		if (!isAlreadyMergeableError(autoMergeError.message)) {
			throw autoMergeError;
		}
		try {
			await api("PUT", `/pulls/${prNumber}/merge`, { merge_method: mergeMethod, sha: headSha }, { token, owner, repo });
		} catch (mergeError) {
			throw new Error(`Could not auto-merge or directly merge PR #${prNumber}. Auto-merge: ${autoMergeError.message} | Direct merge: ${mergeError.message}`);
		}
		return { outcome: "merged-directly", bump, mergeMethod };
	}
}
