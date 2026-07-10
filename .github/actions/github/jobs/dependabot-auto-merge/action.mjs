/**
 * @fileoverview For a Dependabot (or other configured-bot) PR, parse the PR
 * title to determine the semver bump type, verify the base branch has CI
 * gating, approve the PR as the bot, and enable auto-merge via GraphQL.
 * Branch protection still controls when the merge actually fires. The
 * approve/gate/enable-or-merge flow itself lives in api/_api/auto-merge.mjs,
 * shared with redirect-hotfix-pr's replacement-PR flow.
 * Batch 3.2 from tmp/plan-future-workflows.md.
 * @module @cldmv/.github.github.jobs.dependabot-auto-merge
 */

import { getInput, appendSummary } from "../../../common/common/core.mjs";
import { api } from "../../api/_api/core.mjs";
import { approveAndEnableAutoMerge } from "../../api/_api/auto-merge.mjs";

try {
	const bumpTypesRaw = getInput("bump_types") || "patch,minor";
	const mergeMethodInput = (getInput("merge_method") || "merge").toLowerCase();
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

	const result = await approveAndEnableAutoMerge({
		token,
		owner,
		repo,
		prNumber,
		prTitle: livePr.title ?? pr.title,
		prNodeId,
		headSha: livePr.head?.sha,
		baseRef,
		bumpTypes: allowedBumps,
		mergeMethod: mergeMethodInput,
		requireBranchProtection: requireBP
	});

	if (result.outcome === "skipped") {
		console.log(`ℹ️ ${result.reason}`);
		appendSummary(`ℹ️ PR #${prNumber}: ${result.reason}`);
		process.exit(0);
	}

	if (result.outcome === "auto-merge-enabled") {
		console.log(`🚀 Auto-merge enabled on PR #${prNumber} (${result.mergeMethod})`);
		appendSummary(`🚀 **Auto-merge enabled** on PR #${prNumber}: ${result.bump.type} bump ${result.bump.from} → ${result.bump.to}`);
	} else {
		console.log(`🚀 Merged PR #${prNumber} directly (${result.mergeMethod}) — required gates already satisfied.`);
		appendSummary(`🚀 **Merged** PR #${prNumber} (${result.mergeMethod}): ${result.bump.type} bump ${result.bump.from} → ${result.bump.to}`);
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
