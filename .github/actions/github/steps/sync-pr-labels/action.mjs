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
	const mode = (getInput("mode") || "replace").toLowerCase();
	if (mode !== "replace" && mode !== "add") {
		throw new Error(`mode must be 'replace' or 'add', got "${mode}"`);
	}
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	if (labels.length === 0) {
		console.log("ℹ️ No labels to apply.");
		process.exit(0);
	}

	if (mode === "add") {
		// Additive: POST adds labels without removing existing ones.
		console.log(`🏷️ Adding labels (preserving existing): ${labels.join(",")}`);
		await api("POST", `/issues/${prNumber}/labels`, { labels }, { token, owner, repo });
	} else {
		// Full replace: PUT replaces all labels with the given set.
		console.log(`🏷️ Syncing labels (replace): ${labels.join(",")}`);
		await api("PUT", `/issues/${prNumber}/labels`, { labels }, { token, owner, repo });
	}
	console.log(`✅ Labels applied: ${labels.join(",")}`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
