/**
 * @fileoverview Resolve a pull request's base..head commit range. Node
 * entrypoint for the get-pr-commit-range action.
 * @module @cldmv/.github.github.steps.get-pr-commit-range
 */

import { execFileSync } from "node:child_process";
import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput, setOutput } from "../../../common/common/core.mjs";

try {
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const prNumber = getInput("pr-number", { required: true });
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	const pr = await api("GET", `/pulls/${prNumber}`, null, { token, owner, repo });

	// pr.head.sha can be a `chore: bump version` commit that an earlier step of
	// this same job (github/api/commit) created and pushed through the REST API
	// ONLY — it moves refs/heads/<branch> without ever touching this job's local
	// checkout. That sha is therefore absent from the local .git, so a downstream
	// `git log <base>..<that sha>` either fatals (exit 128, crashing the labels
	// step) or silently produces an empty changelog. Re-reading it here also
	// races the ref update's propagation. The release branch is already checked
	// out at its content tip (the bump commit's parent), and the bump commit is
	// filtered out of the changelog/label steps regardless — so the local HEAD is
	// both the correct range head and always locally resolvable. Prefer it; fall
	// back to the API head only if HEAD can't be read (an edge/detached checkout).
	let headSha = pr.head.sha;
	try {
		const localHead = execFileSync("git", ["rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.trim();
		if (localHead) headSha = localHead;
	} catch {
		// Keep the API head.sha when the local HEAD can't be resolved.
	}

	const commitRange = `${pr.base.sha}..${headSha}`;

	setOutput("commit-range", commitRange);
	console.log(`🔍 Using commit range: ${commitRange}`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
