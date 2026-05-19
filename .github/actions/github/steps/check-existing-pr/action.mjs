/**
 * @fileoverview Check whether an open release PR already exists for the given
 * head/base branches. Node entrypoint for the check-existing-pr action.
 * @module @cldmv/.github.github.steps.check-existing-pr
 */

import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput, setOutputs } from "../../../common/common/core.mjs";

try {
	const token = getInput("github-token", { required: true });
	const headBranch = getInput("head-branch");
	let baseBranch = getInput("base-branch");
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	// Detect the default branch when no base branch was supplied.
	if (!baseBranch || baseBranch === "null") {
		console.log("🔍 Base branch not provided, detecting default branch...");
		const repoInfo = await api("GET", "", null, { token, owner, repo });
		baseBranch = repoInfo.default_branch || "master";
		console.log(`🔍 Detected default branch: ${baseBranch}`);
	}

	console.log(`🔍 Checking for existing PR from '${headBranch}' to '${baseBranch}'...`);
	console.log(`🔍 Repository: ${owner}/${repo}`);

	const pulls = await api("GET", `/pulls?head=${owner}:${headBranch}&base=${baseBranch}&state=open`, null, {
		token,
		owner,
		repo
	});
	const existingPr = Array.isArray(pulls) ? pulls[0] : undefined;

	if (existingPr && existingPr.number) {
		console.log(`📋 Existing PR found: #${existingPr.number}`);
		console.log(`🔗 URL: ${existingPr.html_url || ""}`);
		setOutputs({ "pr-exists": "true", "pr-number": String(existingPr.number), "should-skip": "true" });
		console.log(`ℹ️ Since PR #${existingPr.number} already exists, skipping full release processing.`);
		console.log("💡 The PR description should be updated instead of running full workflow.");
	} else {
		console.log("✅ No existing PR found - proceeding with release workflow");
		setOutputs({ "pr-exists": "false", "pr-number": "", "should-skip": "false" });
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
