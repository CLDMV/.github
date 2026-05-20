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

/** Parse Dependabot PR title for "from X.Y.Z to A.B.C" and compute bump type. */
function parseSemverBump(title) {
	const match = title.match(/from (\d+)\.(\d+)\.(\d+)\b.*?\bto (\d+)\.(\d+)\.(\d+)\b/);
	if (!match) return null;
	const [, om, on, op, nm, nn, np] = match.map((s, i) => (i === 0 ? s : Number(s)));
	if (om !== nm) return { type: "major", from: `${om}.${on}.${op}`, to: `${nm}.${nn}.${np}` };
	if (on !== nn) return { type: "minor", from: `${om}.${on}.${op}`, to: `${nm}.${nn}.${np}` };
	return { type: "patch", from: `${om}.${on}.${op}`, to: `${nm}.${nn}.${np}` };
}

try {
	const bumpTypesRaw = getInput("bump_types") || "patch,minor";
	const mergeMethod = (getInput("merge_method") || "squash").toUpperCase(); // GraphQL enum
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

	// Safety: refuse to enable auto-merge if the base branch has no required
	// status checks. Silent auto-merge without CI gating is the dangerous case.
	if (requireBP) {
		try {
			const protection = await api("GET", `/branches/${pr.base.ref}/protection`, null, { token, owner, repo });
			const requiredChecks = protection?.required_status_checks?.contexts || [];
			if (requiredChecks.length === 0) {
				throw new Error(`Base branch "${pr.base.ref}" has no required status checks configured. Refusing to enable auto-merge — this would merge immediately without CI gating. Configure branch protection or set require_branch_protection: false to override.`);
			}
			console.log(`✅ Base "${pr.base.ref}" requires checks: ${requiredChecks.join(", ")}`);
		} catch (err) {
			if (err.message.includes("404")) {
				throw new Error(`Base branch "${pr.base.ref}" has no branch-protection rule. ${err.message}`);
			}
			throw err;
		}
	}

	// Approve the PR as the bot
	console.log(`✅ Approving PR #${prNumber}`);
	await api(
		"POST",
		`/pulls/${prNumber}/reviews`,
		{ event: "APPROVE", body: `Auto-approved by CLDMV-bot: ${bump.type} bump from ${bump.from} to ${bump.to}.` },
		{ token, owner, repo }
	);

	// Enable auto-merge via GraphQL (REST doesn't support "queue for merge when ready")
	console.log(`⏳ Enabling auto-merge (${mergeMethod})`);
	const mutation = `
		mutation EnableAutoMerge($prId: ID!, $method: PullRequestMergeMethod!) {
			enablePullRequestAutoMerge(input: { pullRequestId: $prId, mergeMethod: $method }) {
				pullRequest { autoMergeRequest { enabledAt } }
			}
		}
	`;
	await graphql(token, mutation, {
		prId: pr.node_id,
		method: mergeMethod
	});

	console.log(`🚀 Auto-merge enabled on PR #${prNumber}`);
	appendSummary(`🚀 **Auto-merge enabled** on PR #${prNumber}: ${bump.type} bump ${bump.from} → ${bump.to}`);
	process.exit(0);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
