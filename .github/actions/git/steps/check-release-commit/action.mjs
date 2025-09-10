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
 * Analyze commits for version bump type
 * @param {Array} commits - Array of commit objects
 * @returns {object} Version bump analysis
 */
function analyzeVersionBump(commits) {
	// Filter out release commits for version analysis (but keep them for explicit version extraction)
	const nonReleaseCommits = commits.filter((commit) => {
		const subject = commit.subject.toLowerCase();
		// Filter out: release:, release!:, release(scope):, release(scope)!:
		return !/^release(\([^)]*\))?!?:/.test(subject);
	});

	// Check for breaking changes
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
		// Patterns to match: "release: v1.2.3", "release(api): 1.2.3", "release(ui): bump to v1.2.3", etc.
		const versionPatterns = [/^release(\([^)]*\))?:\s*v?(\d+\.\d+\.\d+)/i, /^release(\([^)]*\))?:\s*.*?v?(\d+\.\d+\.\d+)/i];

		for (const pattern of versionPatterns) {
			const match = releaseCommit.subject.match(pattern);
			if (match) {
				const explicitVersion = match[2]; // Version is in capture group 2 now
				console.log(`🔍 Found explicit version in release commit: ${explicitVersion}`);

				return {
					versionBump: "explicit",
					hasBreaking: false,
					explicitVersion: explicitVersion,
					reason: `Explicit version specified in release commit: ${explicitVersion}`
				};
			}
		}

		console.log(`🔍 Release commit found but no version extracted from: ${releaseCommit.subject}`);
	}

	// Check for features
	const hasFeatures = nonReleaseCommits.some((commit) => commit.category === "feature");

	if (hasFeatures) {
		return {
			versionBump: "minor",
			hasBreaking: false,
			reason: "New features detected"
		};
	}

	// Default to patch
	return {
		versionBump: "patch",
		hasBreaking: false,
		reason: "Only fixes and other changes"
	};
}

// Main logic
if (!HAS_COMMITS) {
	console.log("ℹ️ No commits in range - not triggering release");
	appendFileSync(process.env.GITHUB_OUTPUT, "should-create-pr=false\n");
	process.exit(0);
}

const commits = getCommits();
console.log(`🔍 Analyzing ${commits.length} commits`);

const releaseAnalysis = findReleaseCommits(commits);

if (releaseAnalysis.hasRelease) {
	const releaseCommit = releaseAnalysis.mostRecent;
	console.log(`🔍 Found release commit: ${releaseCommit.subject}`);

	// Output release commit details
	const outputs = [
		"should-create-pr=true",
		`commit-message=${releaseCommit.subject}`,
		`has-breaking=${releaseAnalysis.breakingRelease ? "true" : "false"}`
	];

	if (releaseAnalysis.breakingRelease) {
		outputs.push("version-bump=major");
		console.log("🚀 Breaking release commit detected - will create major version PR");
	} else {
		// For non-breaking release commits, analyze the other commits
		const versionAnalysis = analyzeVersionBump(commits);
		outputs.push(`version-bump=${versionAnalysis.versionBump}`);
		outputs.push(`has-breaking=${versionAnalysis.hasBreaking}`);

		if (versionAnalysis.versionBump === "explicit" && versionAnalysis.explicitVersion) {
			outputs.push(`explicit-version=${versionAnalysis.explicitVersion}`);
			console.log(`🚀 Release commit with explicit version detected - will create PR for version ${versionAnalysis.explicitVersion}`);
		} else {
			console.log(`🚀 Release commit detected - will create ${versionAnalysis.versionBump} version PR (${versionAnalysis.reason})`);
		}
	}

	outputs.forEach((output) => {
		appendFileSync(process.env.GITHUB_OUTPUT, output + "\n");
	});
} else {
	console.log("ℹ️ No release commit found - not triggering release");
	appendFileSync(process.env.GITHUB_OUTPUT, "should-create-pr=false\n");
}
