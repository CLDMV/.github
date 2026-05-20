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

	/** Update an existing PR's title/body and replace its labels. */
	async function updatePr(number) {
		await api("PATCH", `/pulls/${number}`, { title, body: bodyContent }, { token, owner, repo });
		if (labels.length > 0) {
			console.log(`🏷️ Syncing labels: ${labels.join(",")}`);
			await api("PUT", `/issues/${number}/labels`, { labels }, { token, owner, repo });
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
