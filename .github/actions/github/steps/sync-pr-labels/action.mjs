/**
 * @fileoverview Replace a pull request's labels with a given comma-separated
 * set. Node entrypoint for the sync-pr-labels action.
 * @module @cldmv/.github.github.steps.sync-pr-labels
 */

import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput } from "../../../common/common/core.mjs";

try {
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const prNumber = getInput("pr-number", { required: true });
	const labels = getInput("labels", { required: true })
		.split(",")
		.map((label) => label.trim())
		.filter(Boolean);
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	console.log(`🏷️ Syncing labels: ${labels.join(",")}`);
	await api("PUT", `/issues/${prNumber}/labels`, { labels }, { token, owner, repo });
	console.log(`✅ Labels synced: ${labels.join(",")}`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
