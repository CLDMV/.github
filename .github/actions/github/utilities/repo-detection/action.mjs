/**
 * @fileoverview Detect repository visibility and derive publish commands for
 * NPM and GitHub Packages. Node entrypoint for the repo-detection action.
 * @module @cldmv/.github.github.utilities.repo-detection
 */

import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput, setOutputs } from "../../../common/common/core.mjs";

try {
	const token = getInput("github-token", { required: true });
	const packageManager = getInput("package-manager", { default: "npm" });
	const customNpmCommand = getInput("custom-npm-command");
	const customGithubPackagesCommand = getInput("custom-github-packages-command");
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	const repoInfo = await api("GET", "", null, { token, owner, repo });
	const isPrivate = repoInfo.private === true;
	console.log(`Repository is private: ${isPrivate}`);

	const accessLevel = isPrivate ? "restricted" : "public";
	console.log(
		isPrivate
			? "🔒 Private repository detected - using restricted access for auto-detection"
			: "🌍 Public repository detected - using public access for auto-detection"
	);

	const tool = packageManager === "yarn" ? "yarn publish" : "npm publish";

	let npmCommand = customNpmCommand;
	if (!npmCommand) {
		npmCommand = `${tool} --access ${accessLevel}`;
		console.log(`📦 Auto-detected NPM command: ${npmCommand}`);
	} else {
		console.log(`📦 Using custom NPM command: ${npmCommand}`);
	}

	let githubPackagesCommand = customGithubPackagesCommand;
	if (!githubPackagesCommand) {
		githubPackagesCommand = `${tool} --access ${accessLevel}`;
		console.log(`📦 Auto-detected GitHub Packages command: ${githubPackagesCommand}`);
	} else {
		console.log(`📦 Using custom GitHub Packages command: ${githubPackagesCommand}`);
	}

	setOutputs({
		"npm-command": npmCommand,
		"github-packages-command": githubPackagesCommand,
		"repo-is-private": String(isPrivate)
	});
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
