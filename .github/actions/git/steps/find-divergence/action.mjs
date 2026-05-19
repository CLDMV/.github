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

	setOutput("merge-base", mergeBase);
	if (baseVersion) {
		console.log(`📦 Base version at divergence point: ${baseVersion}`);
	} else {
		console.log("⚠️ Could not determine base version — dedup check will be skipped");
	}
	setOutput("base-version", baseVersion);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
