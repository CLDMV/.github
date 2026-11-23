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
import { classifyRange } from "./deps-only.mjs";

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
 * Check if commits contain anything that warrants an automatic release PR.
 * Any non-merge commit qualifies — chore/docs/style/refactor/test/ci batches
 * still need to flow through the persistent release PR (and trigger at least
 * a patch bump) so the work surfaces in the changelog and ships to master
 * via the normal release path. analyzeVersionBump() picks the right bump
 * level from the same set; this gate only decides whether to proceed.
 * @param {Array} commits - Array of commit objects
 * @returns {boolean} True if any commit in the range is not a merge commit.
 */
function hasConventionalCommits(commits) {
	return commits.some((commit) => commit.category !== "merge");
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

/**
 * Strip the conventional-commit prefix (`type(scope)?:` or `type(scope)?!:`)
 * from a subject line, leaving just the human-readable summary.
 * @param {string} subject - Raw commit subject line.
 * @returns {string} Subject with the conventional prefix removed.
 */
function stripConventionalPrefix(subject) {
	return (subject || "").replace(/^[a-z][a-z0-9_-]*(\([^)]*\))?!?:\s*/i, "");
}

/**
 * Strip a leading `vX.Y.Z` (and an optional `-`/`–`/`:` separator) from a
 * string. Applied to an explicit `release: vX.Y.Z - <desc>` subject AFTER the
 * conventional prefix is removed, so the title-suffix is just `<desc>` and not
 * `vX.Y.Z - <desc>` — otherwise the assembled title doubles up as
 * `release: vX.Y.Z - vX.Y.Z - <desc>`.
 * @param {string} s - Subject with the conventional prefix already removed.
 * @returns {string} Subject with any leading version token removed.
 */
function stripLeadingVersion(s) {
	return (s || "").replace(/^v?\d+\.\d+\.\d+\s*[-–:]?\s*/i, "");
}

/**
 * Collapse newlines in a commit subject into spaces and trim it. The length
 * cap is applied to the finished PR title, not here (see
 * github/utilities/release-title.mjs).
 * @param {string} s - Input string.
 * @returns {string}
 */
function cleanSuffix(s) {
	return (s || "").replace(/[\r\n]+/g, " ").trim();
}

/**
 * Derive the "- <subject>" suffix for the PR title, distinguishing release PRs
 * that share the same target version (e.g. two open patch PRs for v3.1.2).
 *
 * Priority:
 *   1. Explicit `release[!]?:` commit on the branch → use that commit's body.
 *   2. Otherwise, pick the OLDEST commit matching the calculated bump:
 *        major → oldest breaking commit
 *        minor → oldest feat
 *        patch → oldest fix
 *      "Oldest" = the commit that originally triggered the PR. Newer follow-up
 *      commits don't push the suffix around — readers expect the title to stay
 *      pinned to what the PR is fundamentally about.
 *   3. Fall back to the oldest actionable commit if nothing matched.
 *
 * Note on order: get-commit-range returns commits newest-first (git log default),
 * so we use findLast/[len-1] to reach the chronologically oldest match.
 *
 * @param {object} releaseAnalysis - Output of findReleaseCommits().
 * @param {Array} actionableCommits - Non-bot-bump commits on the branch.
 * @param {object} versionAnalysis - Output of analyzeVersionBump().
 * @returns {string} The full (untruncated) summary suffix; "" when nothing fits.
 */
function computeTitleSuffix(releaseAnalysis, actionableCommits, versionAnalysis) {
	const explicit = releaseAnalysis.breakingRelease || releaseAnalysis.normalRelease;
	if (explicit) {
		// strip the conventional prefix AND any leading vX.Y.Z so the title isn't
		// "release: vX.Y.Z - vX.Y.Z - <desc>".
		return cleanSuffix(stripLeadingVersion(stripConventionalPrefix(explicit.subject)));
	}

	const bump = versionAnalysis.versionBump;
	let firstMatch;
	if (bump === "major") {
		firstMatch = actionableCommits.findLast((c) => c.isBreaking || c.category === "breaking");
	} else if (bump === "minor") {
		firstMatch = actionableCommits.findLast((c) => c.category === "feature");
	} else if (bump === "patch") {
		firstMatch = actionableCommits.findLast((c) => c.category === "fix");
	}
	if (!firstMatch && actionableCommits.length > 0) firstMatch = actionableCommits[actionableCommits.length - 1];
	if (!firstMatch) return "";

	return cleanSuffix(stripConventionalPrefix(firstMatch.subject));
}

/** Byte budget for the title-candidates output (it is passed on as an action input). */
const TITLE_CANDIDATES_MAX_BYTES = 60000;

/**
 * Every title suffix a commit in the release range could generate, so a
 * refresh can tell a generated PR title from one edited by hand (#523). A new
 * commit can change which commit the suffix comes from, so comparing against
 * today's suffix alone isn't enough.
 *
 * Each commit contributes its subject with the conventional prefix stripped,
 * and with any leading version stripped too (the explicit `release:` form).
 * Commits that can drive the suffix (explicit release, breaking, feat, fix)
 * come first, then the oldest commit (the fallback), then the rest, so the
 * byte cap only ever drops commits that could not have produced the title.
 *
 * @param {Array<{subject: string, category?: string, isBreaking?: boolean}>} commits - Actionable commits, newest first.
 * @param {number} [maxBytes]
 * @returns {string[]}
 */
function titleSuffixCandidates(commits, maxBytes = TITLE_CANDIDATES_MAX_BYTES) {
	const list = commits || [];
	const drives = (c) =>
		/^release(\([^)]*\))?!?:/i.test(c.subject || "") ||
		c.isBreaking ||
		c.category === "breaking" ||
		c.category === "feature" ||
		c.category === "fix";
	const ordered = [...list.filter(drives), ...list.slice(-1), ...list];
	const out = [];
	const seen = new Set();
	let bytes = 2;
	for (const c of ordered) {
		const stripped = stripConventionalPrefix(c.subject);
		for (const s of [cleanSuffix(stripLeadingVersion(stripped)), cleanSuffix(stripped)]) {
			if (!s || seen.has(s)) continue;
			const size = Buffer.byteLength(JSON.stringify(s)) + 1;
			if (bytes + size > maxBytes) return out;
			seen.add(s);
			out.push(s);
			bytes += size;
		}
	}
	return out;
}

/**
 * Whether the target version's bump is already in place on the branch.
 *
 * A `chore: bump version to X` commit in the range is not enough on its own:
 * a later bump can move package.json past X (CLDMV/internal-github-tools went
 * 0.0.1 → 0.0.2 while its base version was unreadable). Only treat X as
 * applied when the branch's package.json still says X, so the next refresh
 * writes X back instead of shipping a title and package.json that disagree.
 *
 * @param {Set<string>} alreadyBumpedVersions - Versions named by bot bump commits in the range.
 * @param {string} targetVersion - Version the release should carry.
 * @param {string} headVersion - package.json version on the branch ("" when unreadable).
 * @returns {boolean}
 */
export function isAlreadyBumped(alreadyBumpedVersions, targetVersion, headVersion) {
	if (!alreadyBumpedVersions.has(targetVersion)) return false;
	return !headVersion || headVersion === targetVersion;
}

/** package.json version in the working tree, or "" when it can't be read. */
function readHeadVersion() {
	try {
		const version = JSON.parse(readFileSync("package.json", "utf8")).version;
		return typeof version === "string" ? version.trim() : "";
	} catch {
		return "";
	}
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

	// An explicit `release:` commit is a maintainer asking for a release, so it is never held.
	const depsOnly = !releaseAnalysis.hasRelease && classifyRange(process.env.BASE_REF);
	console.log(`📦 deps-only range: ${depsOnly}`);

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

		const headVersion = readHeadVersion();
		if (alreadyBumpedVersions.has(targetVersion) && headVersion && headVersion !== targetVersion) {
			console.log(`🔁 ${targetVersion} was bumped earlier, but package.json is now ${headVersion} — bumping back to ${targetVersion}`);
		}

		if (isAlreadyBumped(alreadyBumpedVersions, targetVersion, headVersion)) {
			// Two paths here:
			//   - Callers that *create* (create-release-pr, create-release) want
			//     us to short-circuit — there's nothing new to do.
			//   - Callers that *update* an existing release PR (update-release-pr)
			//     still need downstream steps (changelog regen, PR body refresh,
			//     label sync) to run on subsequent commits, even when the version
			//     target hasn't changed. They opt in via ALLOW_ALREADY_BUMPED=true.
			const allowAlreadyBumped = (process.env.ALLOW_ALREADY_BUMPED || "").trim().toLowerCase() === "true";
			if (!allowAlreadyBumped) {
				console.log(`⏭️ Version ${targetVersion} was already bumped on this branch — skipping`);
				appendFileSync(process.env.GITHUB_OUTPUT, "should-create-pr=false\n");
				process.exit(0);
			}
			console.log(`🔁 Version ${targetVersion} already bumped — body/changelog refresh only (bump-already-applied=true)`);
			const titleSuffix = computeTitleSuffix(releaseAnalysis, actionableCommits, versionAnalysis);
			const outputs = [
				"should-create-pr=true",
				"bump-already-applied=true",
				`commit-message=${commitMessage}`,
				`version-bump=${versionAnalysis.versionBump}`,
				`has-breaking=${versionAnalysis.hasBreaking || false}`,
				`title-suffix=${titleSuffix}`,
				`title-candidates=${JSON.stringify(titleSuffixCandidates(actionableCommits))}`,
				`deps-only=${depsOnly}`
			];
			if (versionAnalysis.versionBump === "explicit" && versionAnalysis.explicitVersion) {
				outputs.push(`explicit-version=${versionAnalysis.explicitVersion}`);
			}
			appendFileSync(process.env.GITHUB_OUTPUT, outputs.join("\n") + "\n");
			process.exit(0);
		}

		console.log(`✅ Target version ${targetVersion} not yet bumped — proceeding`);
	}

	// ── Step 4: Output results ─────────────────────────────────────────────────
	const titleSuffix = computeTitleSuffix(releaseAnalysis, actionableCommits, versionAnalysis);
	const outputs = [
		"should-create-pr=true",
		"bump-already-applied=false",
		`commit-message=${commitMessage}`,
		`version-bump=${versionAnalysis.versionBump}`,
		`has-breaking=${versionAnalysis.hasBreaking || false}`,
		`title-suffix=${titleSuffix}`,
		`title-candidates=${JSON.stringify(titleSuffixCandidates(actionableCommits))}`,
		`deps-only=${depsOnly}`
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
export {
	findReleaseCommits,
	analyzeVersionBump,
	extractExplicitVersion,
	hasConventionalCommits,
	stripConventionalPrefix,
	stripLeadingVersion,
	computeTitleSuffix,
	titleSuffixCandidates
};
