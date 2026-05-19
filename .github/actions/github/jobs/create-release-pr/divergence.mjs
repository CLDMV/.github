/**
 * @fileoverview Write the release-PR start banner and locate the branch's
 * divergence point from the default branch (used as the commit-range base and
 * the version base). Node delegation step of the create-release-pr action.
 * @module @cldmv/.github.github.jobs.create-release-pr.divergence
 */

import { execSync } from "node:child_process";
import { appendSummary, setOutput } from "../../../common/common/core.mjs";

/** Run a git command, returning "" instead of throwing on failure. */
function tryGit(cmd) {
	try {
		return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
	} catch {
		return "";
	}
}

try {
	const dryRun = process.env.DRY_RUN === "true";
	const packageName = process.env.PACKAGE_NAME || "";

	if (dryRun) {
		appendSummary("## 🧪 Dry Run - Release PR Validation");
		appendSummary(`- 🔄 Validating release PR creation for ${packageName} (NO CHANGES WILL BE MADE)`);
	} else {
		appendSummary("## 📋 Release PR Progress");
		appendSummary(`- 🔄 Starting release PR creation for ${packageName}`);
	}
	appendSummary("");

	// Find where this branch diverged from master/main, and read the version
	// at that point so the bump is computed against the correct base.
	const mergeBase = tryGit("git merge-base HEAD origin/master") || tryGit("git merge-base HEAD origin/main");
	let baseVersion = "";
	if (mergeBase) {
		console.log(`🔍 Branch divergence point: ${mergeBase.slice(0, 7)}`);
		const basePackageJson = tryGit(`git show "${mergeBase}:package.json"`);
		if (basePackageJson) {
			try {
				baseVersion = JSON.parse(basePackageJson).version || "";
			} catch {
				baseVersion = "";
			}
		}
	}

	if (baseVersion) {
		console.log(`📦 Base version at divergence point: ${baseVersion}`);
		setOutput("merge-base", mergeBase);
		setOutput("base-version", baseVersion);
	} else {
		console.log("⚠️ Could not determine base version or divergence point — falling back to tag-based range / package.json");
		setOutput("merge-base", "");
		setOutput("base-version", "");
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
