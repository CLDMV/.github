/**
 * @fileoverview Detect the repository's default branch (master or main).
 * Node entrypoint for the detect-default-branch action.
 * @module @cldmv/.github.git.utilities.detect-default-branch
 */

import { execSync } from "node:child_process";
import { setOutput } from "../../../common/common/core.mjs";

/**
 * Run a git command, returning empty string instead of throwing on failure.
 * @param {string} cmd - Git command to run.
 * @returns {string} Trimmed stdout, or "" on error.
 */
function tryGit(cmd) {
	try {
		return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.trim();
	} catch {
		return "";
	}
}

/**
 * Check whether a git ref exists.
 * @param {string} ref - Fully-qualified ref (e.g. refs/remotes/origin/main).
 * @returns {boolean} True if the ref resolves.
 */
function refExists(ref) {
	try {
		execSync(`git show-ref --verify --quiet ${ref}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

try {
	// Primary: ask the remote for its HEAD branch.
	let defaultBranch = "";
	const match = tryGit("git remote show origin").match(/HEAD branch:\s*(\S+)/);
	if (match) defaultBranch = match[1];

	// Fallback: check whether master or main exists (prefer master).
	if (!defaultBranch) {
		if (refExists("refs/remotes/origin/master")) defaultBranch = "master";
		else if (refExists("refs/remotes/origin/main")) defaultBranch = "main";
		else defaultBranch = "master";
	}

	setOutput("default-branch", defaultBranch);
	console.log(`🎯 Default branch detected: ${defaultBranch}`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
