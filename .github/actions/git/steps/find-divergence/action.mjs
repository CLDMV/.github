/**
 * @fileoverview Locate the branch's merge-base with master/main and read the
 * package.json version at that point. Node entrypoint for the find-divergence
 * action.
 * @module @cldmv/.github.git.steps.find-divergence
 */

import { execSync, execFileSync } from "node:child_process";
import { setOutput } from "../../../common/common/core.mjs";

/** Base version for a default branch whose package.json has no `version` field (nothing released yet). */
export const UNRELEASED_BASE_VERSION = "0.0.0";

/**
 * Read the base version from the default branch's package.json text.
 *
 * A package.json with no `version` field means the repo has never released
 * (onboarding adds the field on next, so master gets it with the first
 * release). That is base 0.0.0, not "unknown": an empty base skips the
 * already-bumped check, and every push to next would bump the version again.
 * The same goes for a default branch with no package.json at all (a repo
 * whose first release adds it).
 *
 * @param {string|null} text - package.json contents, or null when the default branch has no package.json.
 * @returns {string} The version, "0.0.0" when the file or its version field is missing, or "" when it can't be read.
 */
export function baseVersionFromPackageJson(text) {
	if (text === null) return UNRELEASED_BASE_VERSION;
	if (!text) return "";
	let pkg;
	try {
		pkg = JSON.parse(text);
	} catch {
		return "";
	}
	if (!pkg || typeof pkg !== "object") return "";
	const version = typeof pkg.version === "string" ? pkg.version.trim() : "";
	return version || UNRELEASED_BASE_VERSION;
}

/** Run a git command (via a shell), returning "" instead of throwing on failure. */
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
 * Like tryGit but argv-based (execFileSync — NO shell), so the resolved base
 * branch name can be interpolated safely. The base comes from repo config (a
 * variable / workflow input / the API default_branch), never PR content, but it
 * still must not reach a shell (js/indirect-command-line-injection).
 */
function tryGitArgs(args) {
	try {
		return execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.trim();
	} catch {
		return "";
	}
}

// Main logic - only run when executed directly (the helpers above are imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
	try {
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
			const pkgPath = `origin/${defaultBranch}:package.json`;
			const hasPackageJson = tryGitArgs(["cat-file", "-t", pkgPath]) === "blob";
			baseVersion = baseVersionFromPackageJson(hasPackageJson ? tryGitArgs(["show", pkgPath]) : null);
			if (baseVersion === UNRELEASED_BASE_VERSION) {
				console.log(
					`📦 ${pkgPath} ${hasPackageJson ? "has no version field" : "does not exist"} — treating the base as ${UNRELEASED_BASE_VERSION} (never released)`
				);
			}
		}

		// Floor the base version at the highest already-released tag (#278). The base
		// above is origin/<default>:package.json, which can LAG the newest published
		// tag — e.g. a concurrent hotfix ships X.Y.Z (and tags it) while this branch's
		// view of the default branch is a step behind. Bumping a lagging base would
		// recompute a version that already shipped, which the publish step cannot
		// republish. Taking the max with the highest release tag keeps "base = latest
		// published state" true. Degrades to no floor when tags can't be read.
		if (baseVersion) {
			const parseSemver = (v) => {
				const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec((v || "").trim());
				return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
			};
			const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
			// ls-remote reflects a tag a concurrent release just pushed, regardless of
			// what this checkout fetched. argv form (execFileSync, no shell), consistent
			// with tryGitArgs above — the args are static, so this is for consistency.
			let tagNames = tryGitArgs(["ls-remote", "--tags", "origin"])
				.split("\n")
				.map((l) => (l.split("\t")[1] || "").replace(/^refs\/tags\//, "").replace(/\^\{\}$/, ""));
			if (!tagNames.some((n) => parseSemver(n))) tagNames = tryGitArgs(["tag", "--list"]).split("\n");
			let top = null;
			for (const n of tagNames) {
				const p = parseSemver(n);
				if (p && (!top || cmp(p, top) > 0)) top = p;
			}
			const base = parseSemver(baseVersion);
			if (top && base && cmp(top, base) > 0) {
				const floored = `${top[0]}.${top[1]}.${top[2]}`;
				console.log(
					`📈 Highest released tag v${floored} exceeds base ${baseVersion} — flooring base at v${floored} to avoid recomputing a shipped version (#278)`
				);
				baseVersion = floored;
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
}
