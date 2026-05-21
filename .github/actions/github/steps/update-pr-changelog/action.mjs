/**
 * @fileoverview Update an existing release PR's title and body with the latest
 * changelog (with a fallback body when no changelog was generated). Node
 * entrypoint for the update-pr-changelog action.
 * @module @cldmv/.github.github.steps.update-pr-changelog
 */

import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput } from "../../../common/common/core.mjs";

const FALLBACK_BODY = [
	"## 🚀 What's Changed",
	"",
	"_Changelog generation in progress. The PR has been updated with the latest commits._",
	"",
	"Please check the commit history for details of the changes included in this release.",
	""
].join("\n");

try {
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const prNumber = getInput("pr-number", { required: true });
	const newVersion = getInput("new-version", { required: true });
	const titleSuffix = (getInput("title-suffix") || "").trim();
	const changelog = getInput("changelog-content");
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	console.log(`📝 Updating PR #${prNumber} title and description...`);

	const body = changelog.trim() ? changelog : FALLBACK_BODY;
	if (!changelog.trim()) console.log("⚠️ No changelog generated, using fallback message");

	const title = titleSuffix ? `release: v${newVersion} - ${titleSuffix}` : `release: v${newVersion}`;
	console.log(`📝 Updating PR title to: ${title}`);
	await api("PATCH", `/pulls/${prNumber}`, { title, body }, { token, owner, repo });

	console.log(`✅ PR #${prNumber} has been updated with title '${title}' and latest changelog`);
	console.log("ℹ️ Skipped full release workflow since PR already exists");
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
