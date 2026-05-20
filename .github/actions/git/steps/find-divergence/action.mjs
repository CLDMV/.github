/**
 * @fileoverview Locate the branch's merge-base with master/main and read the
 * package.json version at that point. Node entrypoint for the find-divergence
 * action.
 * @module @cldmv/.github.git.steps.find-divergence
 */

import { execSync } from "node:child_process";
import { setOutput } from "../../../common/common/core.mjs";

/** Run a git command, returning "" instead of throwing on failure. */
function tryGit(cmd) {
	try {
		return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
	} catch {
		return "";
	}
}

try {
	// Find where this branch diverged from master/main. The merge-base SHA is
	// still used downstream as the commit-range base for changelog generation.
	let mergeBase = tryGit("git merge-base HEAD origin/master");
	let defaultBranch = "";
	if (mergeBase) {
		defaultBranch = "master";
	} else {
		mergeBase = tryGit("git merge-base HEAD origin/main");
		if (mergeBase) defaultBranch = "main";
	}

	// Base version comes from the CURRENT default-branch HEAD, NOT the version
	// at the merge-base. Reading from merge-base freezes the base at branch-
	// creation time; if another release lands on master while this branch is
	// in flight, the bump calculation would target an already-superseded
	// version, causing master to silently regress when this PR merges later.
	// See P3.1 in tmp/plan-future-workflows.md for the full scenario.
	let baseVersion = "";
	if (defaultBranch) {
		console.log(`🔍 Branch divergence point: ${mergeBase.slice(0, 7)} (default branch: ${defaultBranch})`);
		const basePackageJson = tryGit(`git show "origin/${defaultBranch}:package.json"`);
		if (basePackageJson) {
			try {
				baseVersion = JSON.parse(basePackageJson).version || "";
			} catch {
				baseVersion = "";
			}
		}
	}

	setOutput("merge-base", mergeBase);
	if (baseVersion) {
		console.log(`📦 Base version on origin/${defaultBranch}: ${baseVersion}`);
	} else {
		console.log("⚠️ Could not determine base version — dedup check will be skipped");
	}
	setOutput("base-version", baseVersion);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
