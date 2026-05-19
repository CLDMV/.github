/**
 * @fileoverview Resolve the GitHub App bot user ID and configure the global
 * git identity (name + noreply email). Node entrypoint for the
 * setup-git-identity action.
 * @module @cldmv/.github.github.steps.setup-git-identity
 */

import { execSync } from "node:child_process";
import { api } from "../../api/_api/core.mjs";
import { getInput, setOutput } from "../../../common/common/core.mjs";

try {
	const appSlug = getInput("app-slug", { required: true });
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });

	const botUser = `${appSlug}[bot]`;
	const user = await api("GET", `/users/${botUser}`, null, { token });

	const userName = botUser;
	const userEmail = `${user.id}+${botUser}@users.noreply.github.com`;

	execSync(`git config --global user.name "${userName}"`);
	execSync(`git config --global user.email "${userEmail}"`);

	setOutput("user-name", userName);
	setOutput("user-email", userEmail);
	console.log(`🔧 Git identity: ${userName} <${userEmail}>`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
