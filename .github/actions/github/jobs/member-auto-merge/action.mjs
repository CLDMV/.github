/**
 * @fileoverview Auto-enable GitHub's "auto-merge" flag on PRs opened by org
 * members against the v4 integration branches (`next` and `hotfixes`),
 * scoped to the standard branch-prefix conventions. The merge itself still
 * waits for the ruleset's prerequisites (required approvals + status
 * checks) — this just removes the per-PR friction of clicking the button.
 *
 * Intentionally does NOT approve the PR — the human-review gate stays
 * intact. Contrast with dependabot-auto-merge which approves as the bot
 * because the bumps are mechanical and have no human author to gate on.
 *
 * @module @cldmv/.github.github.jobs.member-auto-merge
 */

import { getInput, appendSummary } from "../../../common/common/core.mjs";
import { api } from "../../api/_api/core.mjs";

/** GraphQL helper for enablePullRequestAutoMerge (REST has no equivalent). */
async function graphql(token, query, variables) {
	const res = await fetch("https://api.github.com/graphql", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
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

function csvSet(input, fallback) {
	const raw = (input || fallback || "").split(",").map((s) => s.trim()).filter(Boolean);
	return new Set(raw);
}

function headRefMatches(headRef, prefixes) {
	if (!headRef) return false;
	for (const prefix of prefixes) {
		// Prefixes are stored without the trailing slash; require an exact
		// prefix-with-slash match so `feat` doesn't accidentally match
		// `features-branch` from some unrelated convention.
		if (headRef === prefix || headRef.startsWith(`${prefix}/`)) return true;
	}
	return false;
}

try {
	const token = getInput("github_token", { required: true });
	const mergeMethod = (getInput("merge_method") || "MERGE").toUpperCase(); // GraphQL enum
	const allowedAssociations = csvSet(getInput("allowed_associations"), "MEMBER,OWNER,COLLABORATOR");
	const targetBranches = csvSet(getInput("target_branches"), "next,hotfixes");
	const branchPrefixesRaw = getInput("branch_prefixes") || "feat,feature,fix,hotfix,chore,refactor,docs,ci,perf,test,style";
	const branchPrefixes = branchPrefixesRaw.split(",").map((s) => s.trim()).filter(Boolean);
	const requireBP = (getInput("require_branch_protection") || "true").toLowerCase() === "true";

	const eventPath = process.env.GITHUB_EVENT_PATH;
	if (!eventPath) throw new Error("GITHUB_EVENT_PATH not set");
	const fs = await import("node:fs");
	const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
	const pr = event.pull_request;
	if (!pr) {
		console.log("ℹ️ No pull_request in event; skipping.");
		process.exit(0);
	}

	const prNumber = pr.number;
	const headRef = pr.head?.ref || "";
	const baseRef = pr.base?.ref || "";
	const authorAssociation = pr.author_association || "";
	const author = pr.user?.login || "";

	if (pr.draft) {
		console.log(`ℹ️ PR #${prNumber} is a draft; skipping (will re-fire on ready_for_review).`);
		process.exit(0);
	}

	if (!allowedAssociations.has(authorAssociation)) {
		console.log(
			`ℹ️ PR #${prNumber} author_association=${authorAssociation || "NONE"} (author: ${author}) not in allow-list (${[...allowedAssociations].join(", ")}); skipping.`
		);
		process.exit(0);
	}

	if (!targetBranches.has(baseRef)) {
		console.log(`ℹ️ PR #${prNumber} base=${baseRef} not in target list (${[...targetBranches].join(", ")}); skipping.`);
		process.exit(0);
	}

	if (!headRefMatches(headRef, branchPrefixes)) {
		console.log(`ℹ️ PR #${prNumber} head=${headRef} doesn't match any allowed prefix (${branchPrefixes.join(", ")}); skipping.`);
		process.exit(0);
	}

	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");

	// Safety: refuse to enable auto-merge if the base branch has no required
	// status checks. Silent auto-merge without CI gating is the dangerous case.
	// Rulesets-as-branch-protection: GitHub surfaces effective ruleset checks
	// through the same /branches/{ref}/protection endpoint.
	if (requireBP) {
		try {
			const protection = await api("GET", `/branches/${baseRef}/protection`, null, { token, owner, repo });
			const requiredChecks = protection?.required_status_checks?.contexts || [];
			if (requiredChecks.length === 0) {
				throw new Error(
					`Base branch "${baseRef}" has no required status checks. Refusing to enable auto-merge — it would merge immediately without CI gating. Configure branch-protection / a ruleset with required checks, or set require_branch_protection: false to override.`
				);
			}
			console.log(`✅ Base "${baseRef}" requires checks: ${requiredChecks.join(", ")}`);
		} catch (err) {
			if (err.message.includes("404")) {
				throw new Error(`Base branch "${baseRef}" has no branch-protection rule. ${err.message}`);
			}
			throw err;
		}
	}

	console.log(`⏳ Enabling auto-merge on PR #${prNumber} (${mergeMethod}) — author=${author} association=${authorAssociation}`);
	const mutation = `
		mutation EnableAutoMerge($prId: ID!, $method: PullRequestMergeMethod!) {
			enablePullRequestAutoMerge(input: { pullRequestId: $prId, mergeMethod: $method }) {
				pullRequest { autoMergeRequest { enabledAt } }
			}
		}
	`;
	await graphql(token, mutation, { prId: pr.node_id, method: mergeMethod });

	console.log(`🚀 Auto-merge enabled on PR #${prNumber}`);
	appendSummary(`🚀 **Auto-merge enabled** on PR #${prNumber} (${mergeMethod}) — ${author} (${authorAssociation})`);
	process.exit(0);
} catch (error) {
	// "Pull request is in clean status" / "already enabled" responses
	// from GraphQL should be benign — surface but don't fail the workflow.
	const benign = /already enabled|clean status|automerge already requested/i;
	if (benign.test(error.message)) {
		console.log(`ℹ️ Auto-merge already enabled (or in clean state): ${error.message}`);
		process.exit(0);
	}
	console.error(`::error::${error.message}`);
	process.exit(1);
}
