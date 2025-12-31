/**
 *	@Project: check-release-commit
 *	@Filename: /action.mjs
 *	@Date: 2025-09-09 16:08:15 -07:00 (1757459295)
 *	@Author: Nate Hyson <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Hyson <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2025-12-30 16:58:15 -08:00 (1767142695)
 *	-----
 *	@Copyright: Copyright (c) 2013-2025 Catalyzed Motivation Inc. All rights reserved.
 */

import { appendFileSync } from "fs";

// Get inputs from environment
const COMMITS_JSON = process.env.COMMITS;
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
 * @returns {boolean} True if there are feat, fix, perf, revert, or breaking commits
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
		// Also check for perf: and revert: by type (in case they weren't categorized properly)
		if (commit.type === "perf" || commit.type === "revert") {
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

			return {
				versionBump: "explicit",
				hasBreaking: false,
				explicitVersion: explicitVersion,
				reason: `Explicit version specified in release commit: ${explicitVersion}`
			};
		}

		console.log(`🔍 Release commit found but no version extracted from: ${releaseCommit.subject}`);
	}

	// Check for features (SECOND priority - minor bump)
	const hasFeatures = nonReleaseCommits.some((commit) => commit.category === "feature");

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
		console.log("🔍 DEBUG: This suggests the commit range calculation found no commits");
		console.log("🔍 DEBUG: This could happen if the latest tag is ahead of or equal to HEAD");
		appendFileSync(process.env.GITHUB_OUTPUT, "should-create-pr=false\n");
		process.exit(0);
	}

	const commits = getCommits();
	console.log(`🔍 Analyzing ${commits.length} commits`);
	console.log(
		`🔍 DEBUG: First few commits:`,
		commits.slice(0, 3).map((c) => `${c.hash?.substring(0, 7)}: ${c.subject}`)
	);

	const releaseAnalysis = findReleaseCommits(commits);
	console.log(`🔍 DEBUG: Release analysis result:`, {
		hasRelease: releaseAnalysis.hasRelease,
		breakingRelease: releaseAnalysis.breakingRelease?.subject || null,
		normalRelease: releaseAnalysis.normalRelease?.subject || null,
		mostRecent: releaseAnalysis.mostRecent?.subject || null
	});

	// Check if there are conventional commits even without explicit release: commits
	const hasConventional = hasConventionalCommits(commits);
	console.log(`🔍 DEBUG: Conventional commits detected: ${hasConventional}`);

	// Determine if we should create a release PR
	// This happens if either:
	// 1. There's an explicit release: or release!: commit, OR
	// 2. There are conventional commits (feat:, fix:, breaking changes)
	const shouldCreateRelease = releaseAnalysis.hasRelease || hasConventional;

	if (shouldCreateRelease) {
		let versionAnalysis;
		let commitMessage;

		if (releaseAnalysis.hasRelease) {
			// Explicit release commit found - use it
			const releaseCommit = releaseAnalysis.mostRecent;
			console.log(`🔍 Found release commit: ${releaseCommit.subject}`);
			commitMessage = releaseCommit.subject;

			if (releaseAnalysis.breakingRelease) {
				// Explicit breaking release
				versionAnalysis = {
					versionBump: "major",
					hasBreaking: true,
					reason: "Breaking release commit detected"
				};
				console.log("🚀 Breaking release commit detected - will create major version PR");
			} else {
				// For non-breaking release commits, analyze the other commits
				versionAnalysis = analyzeVersionBump(commits);
				console.log(`🚀 Release commit detected - analyzing other commits for version bump`);
			}
		} else {
			// No explicit release commit, but conventional commits detected
			console.log(`🔍 No explicit release commit, but conventional commits detected - auto-creating release PR`);
			versionAnalysis = analyzeVersionBump(commits);

			// Create a synthetic commit message describing what we found
			if (versionAnalysis.versionBump === "major") {
				commitMessage = "release!: breaking changes detected";
			} else if (versionAnalysis.versionBump === "minor") {
				commitMessage = "release: new features added";
			} else {
				commitMessage = "release: bug fixes and improvements";
			}

			console.log(`🔍 Generated synthetic release message: ${commitMessage}`);
		}

		// Output results
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
	} else {
		console.log("ℹ️ No release commit or conventional commits found - not triggering release");
		appendFileSync(process.env.GITHUB_OUTPUT, "should-create-pr=false\n");
	}
} // End main execution block

// Export functions for testing
export { findReleaseCommits, analyzeVersionBump, extractExplicitVersion, hasConventionalCommits };
