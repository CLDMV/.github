/**
 * @fileoverview Write the release-PR start banner, locate the branch's
 * divergence point from the default branch (used as the commit-range base for
 * changelog generation), and read the CURRENT default-branch package.json
 * version (used as the base for version-bump calculation). Reading from current
 * master rather than the merge-base prevents silent version regressions when
 * parallel release PRs merge out of order — see P3.1 in
 * tmp/plan-future-workflows.md.
 * @module @cldmv/.github.github.jobs.create-release-pr.divergence
 */

import { execSync, execFileSync } from "node:child_process";
import { appendSummary, setOutput } from "../../../common/common/core.mjs";

/** Run a git command (via a shell), returning "" instead of throwing on failure. */
function tryGit(cmd) {
	try {
		return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
	} catch {
		return "";
	}
}

/**
 * Like tryGit but argv-based (execFileSync — NO shell), so the resolved base
 * branch name can be interpolated safely. The base comes from repo config (a
 * variable / workflow input / the API default_branch), never PR content, but it
 * still must not reach a shell (js/indirect-command-line-injection).
 */
function tryGitArgs(args) {
	try {
		return execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
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

	// Find where this branch diverged from the base branch. The merge-base SHA
	// is still used downstream as the commit-range base for changelog generation.
	// When DEFAULT_BRANCH is set (the resolved release base), use it directly;
	// otherwise fall back to the master-then-main heuristic (backward compatible
	// for existing master-default repos).
	const resolvedBase = (process.env.DEFAULT_BRANCH || "").trim();
	let mergeBase = "";
	let defaultBranch = "";
	if (resolvedBase) {
		mergeBase = tryGitArgs(["merge-base", "HEAD", `origin/${resolvedBase}`]);
		if (mergeBase) defaultBranch = resolvedBase;
	} else {
		mergeBase = tryGit("git merge-base HEAD origin/master");
		if (mergeBase) {
			defaultBranch = "master";
		} else {
			mergeBase = tryGit("git merge-base HEAD origin/main");
			if (mergeBase) defaultBranch = "main";
		}
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
		const basePackageJson = tryGitArgs(["show", `origin/${defaultBranch}:package.json`]);
		if (basePackageJson) {
			try {
				baseVersion = JSON.parse(basePackageJson).version || "";
			} catch {
				baseVersion = "";
			}
		}
	}

	if (baseVersion) {
		console.log(`📦 Base version on origin/${defaultBranch}: ${baseVersion}`);
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
