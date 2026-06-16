/**
 * @fileoverview For a Dependabot (or other configured-bot) PR, parse the PR
 * title to determine the semver bump type, verify the base branch has CI
 * gating, approve the PR as the bot, and enable auto-merge via GraphQL.
 * Branch protection still controls when the merge actually fires.
 * Batch 3.2 from tmp/plan-future-workflows.md.
 * @module @cldmv/.github.github.jobs.dependabot-auto-merge
 */

import { getInput, appendSummary } from "../../../common/common/core.mjs";
import { api } from "../../api/_api/core.mjs";
import { parseSemverBump, requiredCheckContextsFromRules, isNotFoundError, allowedMergeMethodsFromRules, chooseMergeMethod } from "./_impl.mjs";

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

try {
	const bumpTypesRaw = getInput("bump_types") || "patch,minor";
	const mergeMethodInput = (getInput("merge_method") || "squash").toLowerCase();
	const alsoActorsRaw = getInput("also_for_actors") || "";
	const requireBP = (getInput("require_branch_protection") || "true").toLowerCase() === "true";
	const token = getInput("github_token", { required: true });

	const allowedBumps = bumpTypesRaw
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	const exemptActors = ["dependabot[bot]", ...alsoActorsRaw.split(",").map((s) => s.trim()).filter(Boolean)];

	// Read the triggering event payload
	const eventPath = process.env.GITHUB_EVENT_PATH;
	if (!eventPath) throw new Error("GITHUB_EVENT_PATH not set");
	const fs = await import("node:fs");
	const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
	const pr = event.pull_request;
	if (!pr) {
		console.log("ℹ️ No pull_request in event; skipping.");
		process.exit(0);
	}

	const author = pr.user?.login || "";
	if (!exemptActors.includes(author)) {
		console.log(`ℹ️ PR author ${author} not in auto-merge list (${exemptActors.join(", ")}); skipping.`);
		process.exit(0);
	}

	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");
	// Fail safe if the env didn't parse to owner/repo — otherwise api() would fall
	// back to a repo-less URL and a 404 there would be misread as "no branch rules".
	if (!owner || !repo) {
		throw new Error(`GITHUB_REPOSITORY is not in "owner/repo" form (got "${repository}"). Refusing to act — cannot resolve the repository for protection checks.`);
	}
	const prNumber = pr.number;

	const bump = parseSemverBump(pr.title);
	if (!bump) {
		console.log(`⚠️ Could not parse bump type from title: "${pr.title}". Skipping (manual review required).`);
		appendSummary(`⚠️ PR #${prNumber}: could not parse bump type; manual review needed.`);
		process.exit(0);
	}

	console.log(`🔍 PR #${prNumber} bump: ${bump.from} → ${bump.to} (${bump.type})`);

	if (!allowedBumps.includes(bump.type)) {
		console.log(`ℹ️ Bump type "${bump.type}" not in allowed list (${allowedBumps.join(", ")}); skipping.`);
		appendSummary(`ℹ️ PR #${prNumber}: ${bump.type} bump not auto-mergeable per policy.`);
		process.exit(0);
	}

	// Re-fetch the PR for its LIVE state. `event.pull_request` (read from
	// GITHUB_EVENT_PATH) is a snapshot frozen when the run first triggered, and a
	// "Re-run" replays that original payload — so its base.ref is stale whenever the
	// PR was retargeted after the event fired. Concretely: Dependabot opens a
	// SECURITY update against the default branch (master), the base is later moved
	// to hotfixes, and a re-run STILL sees base.ref="master" from the snapshot —
	// checking (and potentially auto-merging against) the wrong branch. Gate on the
	// freshly-read base/state instead of the snapshot.
	const livePr = await api("GET", `/pulls/${prNumber}`, null, { token, owner, repo });
	if (livePr.state !== "open" || livePr.merged) {
		console.log(`ℹ️ PR #${prNumber} is no longer open (state=${livePr.state}, merged=${Boolean(livePr.merged)}); skipping.`);
		appendSummary(`ℹ️ PR #${prNumber}: no longer open; nothing to auto-merge.`);
		process.exit(0);
	}
	const baseRef = livePr.base?.ref ?? pr.base?.ref;
	const prNodeId = livePr.node_id ?? pr.node_id;
	// Fail safe on an unexpected payload rather than calling /rules/branches/undefined
	// or sending prId: undefined to GraphQL.
	if (!baseRef || !prNodeId) {
		throw new Error(`Could not resolve the live base branch or node id for PR #${prNumber} (base=${JSON.stringify(baseRef)}, nodeId present=${Boolean(prNodeId)}). Refusing to act — the GitHub API returned an unexpected PR payload.`);
	}
	if (baseRef !== pr.base?.ref) {
		console.log(`🔎 PR #${prNumber} base is now "${baseRef}" (event snapshot said "${pr.base?.ref}") — using the live base.`);
	}

	// Safety: refuse to enable auto-merge unless the PR's base branch is actually
	// protected. Merging immediately without CI gating is the dangerous case.
	//
	// Detection is RULESET-AWARE. The classic `/branches/<b>/protection` endpoint
	// only reports *classic* branch protection and 404s ("Branch not protected")
	// when the branch is governed by a Ruleset — which is how CLDMV repos protect
	// next / hotfixes / master. `/rules/branches/<b>` returns the EFFECTIVE rules
	// for the branch from ALL sources (classic protection + rulesets), so it is
	// the correct single source of truth. `baseRef` is the PR's LIVE base (re-read
	// above), never the stale snapshot and never a hardcoded constant.
	let allowedMerge = [];
	if (requireBP) {
		let rules;
		try {
			rules = await api("GET", `/rules/branches/${encodeURIComponent(baseRef)}`, null, { token, owner, repo });
		} catch (err) {
			// A 404 means the branch genuinely has no effective rules. Any other
			// error (403/permission, network) means protection state is UNKNOWN —
			// fail safe and don't auto-merge, but distinguish it from "confirmed
			// unprotected" so the cause is actionable.
			if (isNotFoundError(err.message)) {
				throw new Error(`Base branch "${baseRef}" has no effective branch rules (classic protection and rulesets both empty). Refusing to enable auto-merge — this would merge without CI gating. Add a ruleset / branch-protection rule or set require_branch_protection: false to override.`);
			}
			throw new Error(`Could not read branch rules for "${baseRef}" (${err.message}). Refusing to enable auto-merge — protection state is unknown. Ensure the token has "Administration: read" (repository rules) on the repo, or set require_branch_protection: false to override.`);
		}

		const requiredCheckContexts = requiredCheckContextsFromRules(rules);

		// Require CI gating specifically: a `required_status_checks` rule with at least
		// one check. An approval-based rule is NOT a sufficient gate here — this action
		// approves the PR as the bot, so any `pull_request` rule (even one requiring
		// reviews, and certainly one with required_approving_review_count: 0) is
		// satisfied by that approval and would let auto-merge fire with no CI. So
		// required_status_checks is the only signal that actually holds the merge.
		if (requiredCheckContexts.length === 0) {
			throw new Error(`Base branch "${baseRef}" has no effective required status checks (checked classic protection + rulesets). Refusing to enable auto-merge — without CI gating it would merge immediately, and the bot's own approval satisfies any approval-only rule. Add a required-status-checks ruleset / branch protection, or set require_branch_protection: false to override.`);
		}
		console.log(`✅ Base "${baseRef}" requires checks (ruleset/classic): ${requiredCheckContexts.join(", ")}`);
		allowedMerge = allowedMergeMethodsFromRules(rules);
	}

	// Choose a merge method the branch actually permits — e.g. a merge-only
	// hotfixes ruleset rejects squash. Honors the configured method when allowed.
	const mergeMethod = chooseMergeMethod(mergeMethodInput, allowedMerge);
	if (mergeMethod !== mergeMethodInput) {
		console.log(`ℹ️ Configured merge method "${mergeMethodInput}" isn't permitted on "${baseRef}"; using "${mergeMethod}" (ruleset allows: ${allowedMerge.join(", ") || "any"}).`);
	}

	// Approve the PR as the bot
	console.log(`✅ Approving PR #${prNumber}`);
	await api(
		"POST",
		`/pulls/${prNumber}/reviews`,
		{ event: "APPROVE", body: `Auto-approved by CLDMV-bot: ${bump.type} bump from ${bump.from} to ${bump.to}.` },
		{ token, owner, repo }
	);

	// Queue auto-merge via GraphQL (REST has no "merge when ready"). This works
	// while a REQUIRED gate is still pending. If the PR's required gates are
	// ALREADY satisfied (checks green by the time we run, plus our own approval),
	// GitHub reports it "clean"/"unstable" and refuses to queue auto-merge — there
	// is nothing left to wait for. Fall back to a direct merge: the merge endpoint
	// re-enforces branch protection (it refuses if a required check isn't met), so
	// the fallback can never merge an ungated PR.
	console.log(`⏳ Enabling auto-merge (${mergeMethod})`);
	const mutation = `
		mutation EnableAutoMerge($prId: ID!, $method: PullRequestMergeMethod!) {
			enablePullRequestAutoMerge(input: { pullRequestId: $prId, mergeMethod: $method }) {
				pullRequest { autoMergeRequest { enabledAt } }
			}
		}
	`;
	try {
		await graphql(token, mutation, { prId: prNodeId, method: mergeMethod.toUpperCase() });
		console.log(`🚀 Auto-merge enabled on PR #${prNumber}`);
		appendSummary(`🚀 **Auto-merge enabled** on PR #${prNumber}: ${bump.type} bump ${bump.from} → ${bump.to}`);
		process.exit(0);
	} catch (autoMergeError) {
		console.log(`ℹ️ Could not queue auto-merge (${autoMergeError.message}). Trying a direct merge (${mergeMethod}) — the merge endpoint still enforces required checks.`);
		try {
			await api("PUT", `/pulls/${prNumber}/merge`, { merge_method: mergeMethod, sha: livePr.head?.sha }, { token, owner, repo });
		} catch (mergeError) {
			throw new Error(`Could not auto-merge or directly merge PR #${prNumber}. Auto-merge: ${autoMergeError.message} | Direct merge: ${mergeError.message}`);
		}
		console.log(`🚀 Merged PR #${prNumber} directly (${mergeMethod}) — required gates already satisfied.`);
		appendSummary(`🚀 **Merged** PR #${prNumber} (${mergeMethod}): ${bump.type} bump ${bump.from} → ${bump.to}`);
		process.exit(0);
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
