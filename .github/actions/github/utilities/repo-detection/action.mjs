/**
 * @fileoverview Detect repository visibility and derive publish commands for
 * NPM and GitHub Packages. Node entrypoint for the repo-detection action.
 * @module @cldmv/.github.github.utilities.repo-detection
 */

import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput, setOutputs } from "../../../common/common/core.mjs";
import { resolvePackageManager } from "../../../npm/utilities/detect-package-manager/resolve.mjs";
import { buildPublishCommand } from "../../../npm/utilities/publish-command/build.mjs";

try {
	const token = getInput("github-token", { required: true });
	const packageManager = resolvePackageManager(getInput("package-manager", { default: "auto" }), ".");
	const customNpmCommand = getInput("custom-npm-command");
	const customGithubPackagesCommand = getInput("custom-github-packages-command");
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	const repoInfo = await api("GET", "", null, { token, owner, repo });
	const isPrivate = repoInfo.private === true;
	console.log(`Repository is private: ${isPrivate}`);

	console.log(
		isPrivate
			? "🔒 Private repository detected - using restricted access for auto-detection"
			: "🌍 Public repository detected - using public access for auto-detection"
	);

	let npmCommand = customNpmCommand;
	if (!npmCommand) {
		// Adds --ignore-scripts always and --provenance for public npm-CLI
		// publishes (see buildPublishCommand). Provenance requires id-token:
		// write on the publish job (granted) and a supported CI (GitHub
		// Actions) — both true in this pipeline. A caller-supplied custom
		// command is left untouched (opts out of both).
		npmCommand = buildPublishCommand({ packageManager, isPrivate, registry: "npm" });
		console.log(`📦 Auto-detected NPM command: ${npmCommand}`);
	} else {
		console.log(`📦 Using custom NPM command: ${npmCommand}`);
	}

	let githubPackagesCommand = customGithubPackagesCommand;
	if (!githubPackagesCommand) {
		githubPackagesCommand = buildPublishCommand({ packageManager, isPrivate, registry: "github-packages" });
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
