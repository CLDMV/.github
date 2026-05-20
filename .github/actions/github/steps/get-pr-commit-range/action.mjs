/**
 * @fileoverview Resolve a pull request's base..head commit range. Node
 * entrypoint for the get-pr-commit-range action.
 * @module @cldmv/.github.github.steps.get-pr-commit-range
 */

import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput, setOutput } from "../../../common/common/core.mjs";

try {
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const prNumber = getInput("pr-number", { required: true });
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	const pr = await api("GET", `/pulls/${prNumber}`, null, { token, owner, repo });
	const commitRange = `${pr.base.sha}..${pr.head.sha}`;

	setOutput("commit-range", commitRange);
	console.log(`🔍 Using commit range: ${commitRange}`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
