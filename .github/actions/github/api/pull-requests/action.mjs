/**
 * @fileoverview Create or update a release pull request (title, body, labels)
 * via the GitHub API. Node entrypoint for the github/api/pull-requests action.
 * @module @cldmv/.github.github.api.pull-requests
 */

import { api, parseRepo } from "../_api/core.mjs";
import { getInput, setOutputs } from "../../../common/common/core.mjs";

try {
	const title = getInput("title", { required: true });
	const baseBranch = getInput("base-branch", { required: true });
	const headBranch = getInput("head-branch", { required: true });
	const bodyContent = getInput("body-content", { required: true });
	const labels = getInput("labels", { default: "release" })
		.split(",")
		.map((label) => label.trim())
		.filter(Boolean);
	const managedLabels = getInput("managed-labels", { default: "" })
		.split(",")
		.map((label) => label.trim())
		.filter(Boolean);

	// Prefer an explicitly-passed token, falling back to the default.
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	console.log(process.env.GITHUB_TOKEN ? "🔑 Using passed GITHUB_TOKEN for GitHub API" : "🔑 Using default github.token for GitHub API");
	console.log(`🔍 Repository: ${owner}/${repo}`);
	console.log(`🔍 Head Branch: ${headBranch}`);
	console.log(`🔍 Base Branch: ${baseBranch}`);

	/** Find the number of an open PR for this head/base, or null. */
	async function findExistingPr() {
		const prs = await api("GET", `/pulls?head=${owner}:${headBranch}&base=${baseBranch}&state=open`, null, { token, owner, repo });
		return Array.isArray(prs) && prs[0]?.number ? prs[0].number : null;
	}

	/**
	 * Update an existing PR's title/body, then sync labels by DELTA. A full
	 * `PUT /labels` is semantically correct but GitHub logs a remove+add for
	 * EVERY label — so each release-PR refresh churned "added X Y Z and removed
	 * X Y Z" even when the set was unchanged. Diffing (only DELETE removed, only
	 * POST added) keeps the activity log quiet. Mirrors steps/sync-pr-labels.
	 *
	 * `managed-labels` SCOPE: when set, removals are restricted to that
	 * allowlist — labels OUTSIDE it (e.g. path-based labels owned by the labeler
	 * workflow) are left alone. Without this, the delta would still strip them
	 * each cycle and the labeler would re-add them. Additions still go through
	 * for any label in `desired` not currently on the PR (caller is trusted to
	 * only add labels it owns).
	 */
	async function updatePr(number) {
		await api("PATCH", `/pulls/${number}`, { title, body: bodyContent }, { token, owner, repo });
		if (labels.length === 0) return;
		const currentArr = await api("GET", `/issues/${number}/labels`, null, { token, owner, repo });
		const current = new Set((currentArr || []).map((l) => l?.name).filter(Boolean));
		const desired = new Set(labels);
		const toAdd = [...desired].filter((l) => !current.has(l));
		const removalScope = managedLabels.length > 0 ? new Set(managedLabels) : null;
		const toRemove = [...current].filter((l) => !desired.has(l) && (removalScope === null || removalScope.has(l)));
		if (toAdd.length === 0 && toRemove.length === 0) {
			console.log(`🏷️ Labels already in sync (${labels.join(",")}) — no changes`);
			return;
		}
		if (toRemove.length) console.log(`🏷️ Removing labels: ${toRemove.join(",")}`);
		if (toAdd.length) console.log(`🏷️ Adding labels: ${toAdd.join(",")}`);
		for (const name of toRemove) {
			await api("DELETE", `/issues/${number}/labels/${encodeURIComponent(name)}`, null, { token, owner, repo });
		}
		if (toAdd.length) {
			await api("POST", `/issues/${number}/labels`, { labels: toAdd }, { token, owner, repo });
		}
	}

	// Update in place if a PR already exists.
	let prNumber = await findExistingPr();
	if (prNumber) {
		console.log(`📋 PR already exists: #${prNumber} — updating title, body, and labels`);
		await updatePr(prNumber);
		console.log(`✅ Updated PR: #${prNumber}`);
		setOutputs({ "pr-number": String(prNumber), "pr-created": "false" });
		process.exit(0);
	}

	// Otherwise create a new PR (raw fetch so a 422 body can be inspected).
	console.log("📋 Creating new PR...");
	const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${token}`,
			"Accept": "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ title, head: headBranch, base: baseBranch, body: bodyContent })
	});
	const data = await response.json().catch(() => ({}));

	if (response.ok && data.number) {
		console.log(`✅ Created PR: #${data.number}`);
		console.log(`🔗 URL: ${data.html_url}`);
		if (labels.length > 0) {
			console.log(`🏷️ Adding labels: ${labels.join(",")}`);
			await api("POST", `/issues/${data.number}/labels`, { labels }, { token, owner, repo });
		}
		setOutputs({ "pr-number": String(data.number), "pr-created": "true" });
		process.exit(0);
	}

	// A "Validation Failed" with "pull request already exists" means another
	// run created it between our check and create — recover by updating it.
	const validationMessage = data?.errors?.[0]?.message || "";
	if (data.message === "Validation Failed" && /pull request already exists/i.test(validationMessage)) {
		console.log("⚠️ PR already exists (detected during creation attempt)");
		console.log("🔍 Re-checking for existing PR to get the number...");
		prNumber = await findExistingPr();
		if (prNumber) {
			console.log(`📋 Found existing PR: #${prNumber} — updating title, body, and labels`);
			await updatePr(prNumber);
			console.log(`✅ Updated PR: #${prNumber}`);
			setOutputs({ "pr-number": String(prNumber), "pr-created": "false" });
			process.exit(0);
		}
		console.error("::error::Could not find existing PR after creation failed");
		process.exit(1);
	}

	console.error("::error::Failed to create PR");
	console.log(`Response: ${JSON.stringify(data)}`);
	console.log("🔍 This may indicate a permissions issue or GitHub App configuration problem.");
	process.exit(1);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
