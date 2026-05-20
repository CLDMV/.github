/**
 * @fileoverview Create a missing semantic version tag via the GitHub refs API
 * (tolerating a concurrent create). Node delegation step of the
 * update-major-version-tags job.
 * @module @cldmv/.github.git.jobs.update-major-version-tags.create-semver-tag
 */

import { execSync } from "node:child_process";
import { api, parseRepo } from "../../../github/api/_api/core.mjs";

try {
	const tagName = process.env.TAG_NAME;
	const tagSha = process.env.TAG_SHA;
	const token = process.env.GITHUB_TOKEN;
	const { owner, repo } = parseRepo(process.env.REPOSITORY || process.env.GITHUB_REPOSITORY);

	console.log(`🏷️  Creating missing semver tag ${tagName} → ${tagSha}`);

	try {
		await api("POST", "/git/refs", { ref: `refs/tags/${tagName}`, sha: tagSha }, { token, owner, repo });
		console.log(`✅ Created tag ${tagName}`);
	} catch (error) {
		// 422 means the ref already exists (race condition) — safe to continue.
		if (/-> 422\b/.test(error.message)) {
			console.log(`ℹ️  Tag ${tagName} already exists (created concurrently) — continuing`);
		} else {
			throw error;
		}
	}

	// Refresh the local tag cache so the next step sees the new tag.
	execSync("git fetch --tags --force", { stdio: "inherit" });
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
