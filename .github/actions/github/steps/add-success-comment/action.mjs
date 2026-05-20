/**
 * @fileoverview Post a "package published" comment on the relevant commit.
 * Node entrypoint for the add-success-comment action (previously an inline
 * actions/github-script block).
 * @module @cldmv/.github.github.steps.add-success-comment
 */

import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput, getEventPayload } from "../../../common/common/core.mjs";

try {
	const version = getInput("version", { required: true });
	const packageName = getInput("package-name", { required: true });
	const publishToNPM = getInput("publish-to-npm") === "true";
	const publishToGitHub = getInput("publish-to-github-packages") === "true";
	const npmPublished = getInput("npm-published") === "true";
	const githubPublished = getInput("github-packages-published") === "true";
	const token = getInput("github-token", { required: true });

	const repository = process.env.GITHUB_REPOSITORY;
	const { owner, repo } = parseRepo(repository);

	let comment = `🎉 **Package published successfully!**\n\n🏷️ **Version:** ${version}`;
	if (publishToNPM && npmPublished) {
		comment +=
			`\n\n📦 **NPM:** [${packageName}@${version}](https://www.npmjs.com/package/${packageName})` +
			`\n📥 **Install:** \`npm install ${packageName}@${version}\``;
	}
	if (publishToGitHub && githubPublished) {
		comment +=
			`\n\n📦 **GitHub Packages:** [${packageName}@${version}](https://github.com/${repository}/packages/)` +
			`\n📥 **Install from GitHub:** \`npm install --registry=https://npm.pkg.github.com ${packageName}@${version}\``;
	}
	comment += "\n\nThe package is now available for installation! 🚀";

	// Resolve the commit to comment on: the PR head, the pushed ref, or the
	// default branch.
	const prSha = getEventPayload()?.pull_request?.head?.sha;
	const refIn = (process.env.GITHUB_REF || "").replace(/^refs\//, "");
	let ref;
	if (/^heads\/|^tags\//.test(refIn)) {
		ref = refIn;
	} else {
		const repoInfo = await api("GET", "", null, { token, owner, repo });
		ref = `heads/${repoInfo.default_branch}`;
	}

	const refData = await api("GET", `/git/ref/${ref}`, null, { token, owner, repo });
	const commitSha = prSha ?? refData.object.sha;

	await api("POST", `/commits/${commitSha}/comments`, { body: comment }, { token, owner, repo });
	console.log(`✅ Successfully added comment to commit ${commitSha}`);
} catch (error) {
	// A failed comment must not fail the workflow.
	console.log(`⚠️ Failed to add commit comment: ${error.message}`);
}
