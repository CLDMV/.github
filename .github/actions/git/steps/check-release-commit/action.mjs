/**
 *	@Project: @cldmv/.github
 *	@Filename: /.github/actions/git/steps/check-release-commit/action.mjs
 *	@Date: 2025-09-09 16:08:15 -07:00 (1757459295)
 *	@Author: Nate Hyson <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-04-12 23:56:09 -07:00 (1776063369)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 */

import { appendFileSync, readFileSync } from "fs";

// Get inputs from environment.
// COMMITS_FILE is preferred over COMMITS to avoid shell "Argument list too long" errors
// when the JSON payload is large (many commits). Fall back to COMMITS for backward compat.
const COMMITS_FILE = process.env.COMMITS_FILE;
const COMMITS_JSON = (() => {
	if (COMMITS_FILE) {
		try {
			return readFileSync(COMMITS_FILE, "utf8");
		} catch (err) {
			console.log(`⚠️ Failed to read commits file '${COMMITS_FILE}': ${err.message}. Falling back to COMMITS env var.`);
		}
	}
	return process.env.COMMITS;
})();
const HAS_COMMITS = process.env.HAS_COMMITS === "true";

console.log("🔍 Checking for release commits...");

/**
 * Parse commits from JSON
 * @returns {Array} Array of commit objects
 */
function getCommits() {
	try {
		const commits = JSON.parse(COMMITS_JSON || "[]");
		return commits;
	} catch (error) {
		console.log(`🔍 DEBUG: Failed to parse commits JSON: ${error.message}`);
		return [];
	}
}

/**
 * Find release commits in the commit list
 * @param {Array} commits - Array of commit objects
 * @returns {object} Release commit analysis
 */
function findReleaseCommits(commits) {
	const releaseCommits = commits.filter((commit) => {
		const subject = commit.subject.toLowerCase();
		// Match: release:, release!:, release(scope):, release(scope)!:
		return /^release(\([^)]*\))?!?:/.test(subject);
	});

	// Find the most recent release commit
	const breakingRelease = releaseCommits.find((commit) => {
		const subject = commit.subject.toLowerCase();
		// Match: release!: or release(scope)!:
		return /^release(\([^)]*\))?!:/.test(subject);
	});

	const normalRelease = releaseCommits.find((commit) => {
		const subject = commit.subject.toLowerCase();
		// Match: release: or release(scope): but NOT release!: or release(scope)!:
		return /^release(\([^)]*\))?:/.test(subject) && !/^release(\([^)]*\))?!:/.test(subject);
	});

	return {
		hasRelease: releaseCommits.length > 0,
		breakingRelease,
		normalRelease,
		mostRecent: breakingRelease || normalRelease
	};
}

/**
 * Check if commits contain conventional commits that warrant automatic release
 * @param {Array} commits - Array of commit objects
 * @returns {boolean} True if there are feat/feature, fix, perf, revert, or breaking commits
 */
function hasConventionalCommits(commits) {
	return commits.some((commit) => {
		// Exclude merge commits and maintenance commits
		if (commit.category === "merge" || commit.category === "maintenance") {
			return false;
		}
		// Include breaking, feature, fix, perf, or revert commits
		// These all represent user-facing changes that warrant a release
		if (commit.category === "breaking" || commit.category === "feature" || commit.category === "fix") {
			return true;
		}
		// Also check by raw type as a fallback (in case the commit wasn't categorized properly).
		// feat/feature → feature, perf → perf, revert → revert
		if (commit.type === "feat" || commit.type === "feature" || commit.type === "perf" || commit.type === "revert") {
			return true;
		}
		return false;
	});
}

/**
 * Extract explicit version from a release commit subject
 * @param {string} subject - Commit subject line
 * @returns {string|null} Extracted version or null if not found
 */
function extractExplicitVersion(subject) {
	// Patterns to match: "release: v1.2.3", "release(api): 1.2.3", "release(ui): bump to v1.2.3", etc.
	const versionPatterns = [/^release(\([^)]*\))?:\s*v?(\d+\.\d+\.\d+)/i, /^release(\([^)]*\))?:\s*.*?v?(\d+\.\d+\.\d+)/i];

	for (const pattern of versionPatterns) {
		const match = subject.match(pattern);
		if (match) {
			return match[2]; // Version is in capture group 2
		}
	}
	return null;
}

/**
 * Analyze commits for version bump type
 * This calculates the HIGHEST version bump needed across all commits
 * (not cumulative - always calculate from the original/base version)
 * @param {Array} commits - Array of commit objects
 * @returns {object} Version bump analysis
 */
function analyzeVersionBump(commits) {
	// Filter out release commits and merge commits for version analysis (but keep them for explicit version extraction)
	const nonReleaseCommits = commits.filter((commit) => {
		const subject = commit.subject.toLowerCase();
		// Filter out: release:, release!:, release(scope):, release(scope)!:, and merge commits
		return !/^release(\([^)]*\))?!?:/.test(subject) && commit.category !== "merge";
	});

	// Check for breaking changes (HIGHEST priority - major bump)
	const hasBreaking = nonReleaseCommits.some((commit) => commit.category === "breaking" || commit.isBreaking);

	if (hasBreaking) {
		return {
			versionBump: "major",
			hasBreaking: true,
			reason: "Breaking changes detected in commit history"
		};
	}

	// Check for explicit version in release commits (from original commits array, not filtered)
	const releaseCommits = commits.filter((commit) => {
		const subject = commit.subject.toLowerCase();
		// Match: release: or release(scope): but NOT release!: or release(scope)!:
		return /^release(\([^)]*\))?:/.test(subject) && !/^release(\([^)]*\))?!:/.test(subject);
	});

	if (releaseCommits.length > 0) {
		const releaseCommit = releaseCommits[0]; // Use the first/most recent release commit

		// Try to extract version from commit message
		const explicitVersion = extractExplicitVersion(releaseCommit.subject);
		if (explicitVersion) {
			console.log(`🔍 Found explicit version in release commit: ${explicitVersion}`);

			// Only use the explicit version when the release commit is the sole trigger
			// (no non-release commits alongside it). If non-release commits are also present
			// (e.g. a fix that landed after the release was squashed into master), those
			// commits represent work that needs its own version bump PAST the release version.
			// Fall through to normal bump detection so they drive the bump type.
			if (nonReleaseCommits.length === 0) {
				return {
					versionBump: "explicit",
					hasBreaking: false,
					explicitVersion: explicitVersion,
					reason: `Explicit version specified in release commit: ${explicitVersion}`
				};
			}

			console.log(
				`🔍 Non-release commits present alongside release commit — falling through to bump detection (ignoring explicit version ${explicitVersion})`
			);
		} else {
			console.log(`🔍 Release commit found but no version extracted from: ${releaseCommit.subject}`);
		}
	}

	// Check for features (SECOND priority - minor bump)
	// Check both category (set by get-commit-range) and raw type as a fallback for feat/feature.
	const hasFeatures = nonReleaseCommits.some(
		(commit) => commit.category === "feature" || commit.type === "feat" || commit.type === "feature"
	);

	if (hasFeatures) {
		return {
			versionBump: "minor",
			hasBreaking: false,
			reason: "New features detected"
		};
	}

	// Check for fixes, performance improvements, or reverts (THIRD priority - patch bump)
	const hasFixes = nonReleaseCommits.some((commit) => commit.category === "fix");
	const hasPerf = nonReleaseCommits.some((commit) => commit.type === "perf");
	const hasRevert = nonReleaseCommits.some((commit) => commit.type === "revert");

	if (hasFixes || hasPerf || hasRevert) {
		const reasons = [];
		if (hasFixes) reasons.push("bug fixes");
		if (hasPerf) reasons.push("performance improvements");
		if (hasRevert) reasons.push("reverts");

		return {
			versionBump: "patch",
			hasBreaking: false,
			reason: reasons.join(", ") + " detected"
		};
	}

	// Default to patch for any other changes
	return {
		versionBump: "patch",
		hasBreaking: false,
		reason: "Other changes detected"
	};
}

// Main logic - only run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	console.log(`🔍 DEBUG: HAS_COMMITS = ${HAS_COMMITS}`);
	console.log(`🔍 DEBUG: COMMITS_JSON length = ${COMMITS_JSON ? COMMITS_JSON.length : "null"}`);

	if (!HAS_COMMITS) {
		console.log("ℹ️ No commits in range - not triggering release");
		appendFileSync(process.env.GITHUB_OUTPUT, "should-create-pr=false\n");
		process.exit(0);
	}

	const commits = getCommits();
	console.log(`🔍 Analyzing ${commits.length} commits since branch was created`);

	// ── Step 1: Separate bot bump commits from real work ───────────────────────
	const botBumpRe = /^chore(\([^)]*\))?:\s*bump version to v?(\d+\.\d+\.\d+)/i;

	const bumpCommits = commits.filter((c) => botBumpRe.test(c.subject));
	const actionableCommits = commits.filter((c) => !botBumpRe.test(c.subject));

	const alreadyBumpedVersions = new Set(bumpCommits.map((c) => c.subject.match(botBumpRe)?.[2]).filter(Boolean));

	console.log(`🔍 Bot bump commits found: ${bumpCommits.length} (versions: ${[...alreadyBumpedVersions].join(", ") || "none"})`);
	console.log(`🔍 Actionable commits: ${actionableCommits.length}`);

	if (actionableCommits.length === 0) {
		console.log("ℹ️ No actionable commits — nothing to release");
		appendFileSync(process.env.GITHUB_OUTPUT, "should-create-pr=false\n");
		process.exit(0);
	}

	// ── Step 2: Determine what the version bump SHOULD be ─────────────────────
	const releaseAnalysis = findReleaseCommits(actionableCommits);
	const hasConventional = hasConventionalCommits(actionableCommits);
	const shouldCreateRelease = releaseAnalysis.hasRelease || hasConventional;

	if (!shouldCreateRelease) {
		console.log("ℹ️ No release commit or conventional commits found - not triggering release");
		appendFileSync(process.env.GITHUB_OUTPUT, "should-create-pr=false\n");
		process.exit(0);
	}

	let versionAnalysis;
	let commitMessage;

	if (releaseAnalysis.hasRelease && releaseAnalysis.breakingRelease) {
		versionAnalysis = { versionBump: "major", hasBreaking: true, reason: "Breaking release commit detected" };
		commitMessage = releaseAnalysis.breakingRelease.subject;
	} else if (releaseAnalysis.hasRelease) {
		versionAnalysis = analyzeVersionBump(actionableCommits);
		commitMessage = releaseAnalysis.mostRecent.subject;
	} else {
		versionAnalysis = analyzeVersionBump(actionableCommits);
		if (versionAnalysis.versionBump === "major") commitMessage = "release!: breaking changes detected";
		else if (versionAnalysis.versionBump === "minor") commitMessage = "release: new features added";
		else commitMessage = "release: bug fixes and improvements";
	}

	console.log(`🔍 Version bump required: ${versionAnalysis.versionBump} (${versionAnalysis.reason})`);

	// ── Step 3: Compute target version and dedup ───────────────────────────────
	const baseVersion = process.env.BASE_VERSION?.trim();
	if (baseVersion && versionAnalysis.versionBump !== "explicit") {
		const [maj, min, pat] = baseVersion.split(".").map(Number);
		let targetVersion;
		if (versionAnalysis.versionBump === "major") targetVersion = `${maj + 1}.0.0`;
		else if (versionAnalysis.versionBump === "minor") targetVersion = `${maj}.${min + 1}.0`;
		else targetVersion = `${maj}.${min}.${pat + 1}`;

		console.log(`🔍 Base version: ${baseVersion} → target: ${targetVersion}`);

		if (alreadyBumpedVersions.has(targetVersion)) {
			console.log(`⏭️ Version ${targetVersion} was already bumped on this branch — skipping`);
			appendFileSync(process.env.GITHUB_OUTPUT, "should-create-pr=false\n");
			process.exit(0);
		}

		console.log(`✅ Target version ${targetVersion} not yet bumped — proceeding`);
	}

	// ── Step 4: Output results ─────────────────────────────────────────────────
	const outputs = [
		"should-create-pr=true",
		`commit-message=${commitMessage}`,
		`version-bump=${versionAnalysis.versionBump}`,
		`has-breaking=${versionAnalysis.hasBreaking || false}`
	];

	if (versionAnalysis.versionBump === "explicit" && versionAnalysis.explicitVersion) {
		outputs.push(`explicit-version=${versionAnalysis.explicitVersion}`);
		console.log(`🚀 Will create PR for explicit version ${versionAnalysis.explicitVersion}`);
	} else {
		console.log(`🚀 Will create ${versionAnalysis.versionBump} version PR (${versionAnalysis.reason})`);
	}

	outputs.forEach((output) => {
		appendFileSync(process.env.GITHUB_OUTPUT, output + "\n");
	});
} // End main execution block

// Export functions for testing
export { findReleaseCommits, analyzeVersionBump, extractExplicitVersion, hasConventionalCommits };
