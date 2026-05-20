/**
 * @fileoverview Commit and push badge.json to the badges branch, creating it
 * as an orphan branch on first run and skipping the commit when unchanged.
 * Node entrypoint for the push-badge action.
 * @module @cldmv/.github.coverage.steps.push-badge
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getInput } from "../../../common/common/core.mjs";

try {
	const badgesBranch = getInput("badges-branch", { default: "badges" });
	const badgeFile = getInput("badge-filename", { default: "coverage.json" });
	const botName = getInput("bot-name", { required: true });
	const botEmail = getInput("bot-email", { required: true });
	const botToken = process.env.BOT_TOKEN || getInput("bot-token");
	const repository = getInput("repository", { required: true });

	console.log("::notice::push coverage badge (Node)");

	execSync(`git config user.name "${botName}"`);
	execSync(`git config user.email "${botEmail}"`);

	// Stash the computed badge outside the work tree before switching branches.
	const stashedBadge = path.join(process.env.RUNNER_TEMP || ".", badgeFile);
	fs.copyFileSync("badge.json", stashedBadge);

	// The type-check / coverage runs leave the tree dirty; git won't switch
	// branches with a dirty tree, so stash everything first.
	console.log("Stashing working tree before branch switch…");
	try {
		execSync('git stash push --include-untracked --message "badge-branch-switch"', { stdio: "inherit" });
	} catch {
		// Nothing to stash is fine.
	}

	let fetched = false;
	try {
		execSync(`git fetch origin "${badgesBranch}"`, { stdio: "ignore" });
		fetched = true;
	} catch {
		fetched = false;
	}

	if (fetched) {
		execSync(`git checkout "${badgesBranch}"`, { stdio: "inherit" });
	} else {
		// First run: create an orphan branch with no history.
		execSync(`git checkout --orphan "${badgesBranch}"`, { stdio: "inherit" });
		try {
			execSync("git rm -rf . --quiet", { stdio: "ignore" });
		} catch {
			// Empty tree is fine.
		}
	}

	fs.copyFileSync(stashedBadge, badgeFile);
	execSync(`git add "${badgeFile}"`);

	let unchanged = false;
	try {
		execSync("git diff --cached --quiet", { stdio: "ignore" });
		unchanged = true;
	} catch {
		unchanged = false;
	}
	if (unchanged) {
		console.log("Badge unchanged — skipping commit.");
		process.exit(0);
	}

	execSync('git commit -S -m "ci: update coverage badge"', { stdio: "inherit" });
	execSync(`git push "https://x-access-token:${botToken}@github.com/${repository}.git" "${badgesBranch}"`, { stdio: "inherit" });
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
