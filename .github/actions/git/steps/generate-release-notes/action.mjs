import { writeFileSync, appendFileSync } from "fs";

// Get inputs from environment
const VERSION = process.env.VERSION;
const COMMITS_JSON = process.env.COMMITS;
const HAS_COMMITS = process.env.HAS_COMMITS === "true";
const PACKAGE_NAME = process.env.PACKAGE_NAME;
const PACKAGE_MANAGER = process.env.PACKAGE_MANAGER;

console.log(`📋 Generating release notes for version: ${VERSION}`);

/**
 * Parse commits from JSON and filter by category
 * @param {string} category - Category to filter by
 * @returns {Array} Filtered commits
 */
function getCommitsByCategory(category) {
	try {
		const commits = JSON.parse(COMMITS_JSON || "[]");
		return commits.filter((commit) => commit.category === category);
	} catch (error) {
		console.log(`🔍 DEBUG: Failed to parse commits JSON: ${error.message}`);
		return [];
	}
}

/**
 * Format commits for display in release notes
 * @param {Array} commits - Array of commit objects
 * @returns {string} Formatted commit lines
 */
function formatCommits(commits) {
	if (!commits.length) return "";

	return commits
		.map((commit) => {
			let line = `- ${commit.subject} (${commit.hash})`;
			if (commit.isBreaking) {
				line = `- 💥 ${commit.subject} (${commit.hash})`;
			}
			return line;
		})
		.join("\n");
}

let releaseNotes = "## 🚀 What's Changed\n\n";

if (!HAS_COMMITS) {
	console.log("ℹ️ No commits found in range - this may be a re-release or tag-only release");
	releaseNotes += "_No new commits since last release_\n";
} else {
	try {
		const allCommits = JSON.parse(COMMITS_JSON || "[]");
		console.log(`🔍 DEBUG: Processing ${allCommits.length} commits`);

		// Debug: Show commit categories
		const categoryCounts = allCommits.reduce((acc, commit) => {
			acc[commit.category] = (acc[commit.category] || 0) + 1;
			return acc;
		}, {});
		console.log("🔍 DEBUG: Commit categories:", categoryCounts);
		
		// Debug: Show each commit and its category
		console.log("🔍 DEBUG: Individual commits and categories:");
		allCommits.forEach((commit) => {
			console.log(`  ${commit.hash}: "${commit.subject}" → ${commit.category}`);
		});
	} catch (error) {
		console.log(`🔍 DEBUG: Could not parse commits: ${error.message}`);
	}

	// Breaking Changes
	releaseNotes += "### 💥 Breaking Changes\n";
	const breakingCommits = getCommitsByCategory("breaking");

	if (breakingCommits.length > 0) {
		releaseNotes += formatCommits(breakingCommits) + "\n";
	} else {
		releaseNotes += "_No breaking changes_\n";
	}
	releaseNotes += "\n";

	// Features
	releaseNotes += "### ✨ Features\n";
	const featureCommits = getCommitsByCategory("feature");

	if (featureCommits.length > 0) {
		releaseNotes += formatCommits(featureCommits) + "\n";
	} else {
		releaseNotes += "_No new features_\n";
	}
	releaseNotes += "\n";

	// Bug Fixes
	releaseNotes += "### 🐛 Bug Fixes\n";
	const fixCommits = getCommitsByCategory("fix");

	if (fixCommits.length > 0) {
		releaseNotes += formatCommits(fixCommits) + "\n";
	} else {
		releaseNotes += "_No bug fixes_\n";
	}
	releaseNotes += "\n";

	// Other Changes - exclude maintenance commits
	releaseNotes += "### 🔧 Other Changes\n";
	const otherCommits = getCommitsByCategory("other");

	if (otherCommits.length > 0) {
		releaseNotes += formatCommits(otherCommits) + "\n";
	} else {
		releaseNotes += "_No other changes_\n";
	}
	releaseNotes += "\n";
}

// Installation section
releaseNotes += "## 📦 Installation\n\n";
releaseNotes += "```bash\n";
if (PACKAGE_MANAGER === "yarn") {
	releaseNotes += `yarn add ${PACKAGE_NAME}@${VERSION}\n`;
} else {
	releaseNotes += `npm install ${PACKAGE_NAME}@${VERSION}\n`;
}
releaseNotes += "```\n";

// Write to file and output
writeFileSync("RELEASE_NOTES.md", releaseNotes);
console.log("📋 Release notes generated successfully");

// Output for GitHub Actions
appendFileSync(process.env.GITHUB_OUTPUT, `release-notes<<EOF\n${releaseNotes}\nEOF\n`);
