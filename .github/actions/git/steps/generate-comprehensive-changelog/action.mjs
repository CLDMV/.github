import { appendFileSync } from "fs";
import { gitCommand } from "../../utilities/git-utils.mjs";
import { categorizeCommits } from "../get-commit-range/action.mjs";

// Get inputs from environment
const COMMITS_INPUT = process.env.COMMITS_INPUT;
const COMMIT_RANGE_INPUT = process.env.COMMIT_RANGE_INPUT;

/**
 * Generate comprehensive changelog based on git commit history
 * @param {string} commitRange - Git commit range (e.g., "v1.0.0..HEAD")
 * @param {Array} commits - Optional pre-categorized commits array for testing
 * @returns {string} Generated changelog content
 */
function generateComprehensiveChangelog(commitRange = null, commits = null) {
	let lastTag = "";
	let range = "";

	if (!commitRange && !commits) {
		// Try to find the last release tag
		try {
			lastTag = gitCommand("git describe --tags --abbrev=0", true);
			console.log(`Last tag: ${lastTag}`);
			range = `${lastTag}..HEAD`;
		} catch (error) {
			console.log("No previous tags found, using initial commit");
			const initialCommit = gitCommand("git rev-list --max-parents=0 HEAD", true);
			range = `${initialCommit}..HEAD`;
		}
	} else {
		range = commitRange || "HEAD";
	}

	let changelog = "## 🚀 What's Changed\n\n";

	if (!commits) {
		console.log(`⚠️ No commits provided, using categorizeCommits with range: ${range}`);
		commits = categorizeCommits(range);
		console.log(`📋 Categorized ${commits.length} commits from git history`);
	}

	// Don't filter out release commits - they may contain useful information

	// Breaking Changes - use proper categorization
	changelog += "### 💥 Breaking Changes\n";
	const breakingCommits = commits.filter((c) => c.category === "breaking" || c.isBreaking);
	if (breakingCommits.length > 0) {
		breakingCommits.forEach((c) => {
			changelog += `- ${c.subject} (${c.hash})\n`;
		});
	} else {
		changelog += "_No breaking changes_\n";
	}
	changelog += "\n";

	// Features - use proper categorization
	changelog += "### ✨ Features\n";
	const featureCommits = commits.filter((c) => c.category === "feature");
	if (featureCommits.length > 0) {
		featureCommits.forEach((c) => {
			changelog += `- ${c.subject} (${c.hash})\n`;
		});
	} else {
		changelog += "_No new features_\n";
	}
	changelog += "\n";

	// Bug Fixes - use proper categorization
	changelog += "### 🐛 Bug Fixes\n";
	const fixCommits = commits.filter((c) => c.category === "fix");
	if (fixCommits.length > 0) {
		fixCommits.forEach((c) => {
			changelog += `- ${c.subject} (${c.hash})\n`;
		});
	} else {
		changelog += "_No bug fixes_\n";
	}
	changelog += "\n";

	// Other Changes - maintenance and other categories (excluding release commits)
	changelog += "### 🔧 Other Changes\n";
	const otherCommits = commits.filter((c) => (c.category === "maintenance" || c.category === "other") && c.type !== "release");
	if (otherCommits.length > 0) {
		otherCommits.forEach((c) => {
			changelog += `- ${c.subject} (${c.hash})\n`;
		});
	} else {
		changelog += "_No other changes_\n";
	}
	changelog += "\n";

	// Contributors
	changelog += "### 👥 Contributors\n";
	const contributors = [...new Set(commits.map((c) => c.author))];
	contributors.forEach((author) => {
		changelog += `- ${author}\n`;
	});

	return changelog;
}

// Main logic - only run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	let commits = null;
	let commitRange = null;

	// Try to parse commits from input
	if (COMMITS_INPUT) {
		try {
			commits = JSON.parse(COMMITS_INPUT);
			console.log(`📋 Using provided commits: ${commits.length} commits`);
		} catch (error) {
			console.log("⚠️ Failed to parse commits input, falling back to git commands");
			console.log(`Debug: COMMITS_INPUT = ${COMMITS_INPUT}`);
		}
	} else {
		console.log("⚠️ No commits input provided, falling back to git commands");
	}

	// Use commit range if provided
	if (COMMIT_RANGE_INPUT) {
		commitRange = COMMIT_RANGE_INPUT;
		console.log(`📋 Using commit range: ${commitRange}`);
	}

	const changelog = generateComprehensiveChangelog(commitRange, commits);
	console.log("📄 Generated comprehensive changelog");

	// Output the changelog content
	appendFileSync(process.env.GITHUB_OUTPUT, `changelog-content<<EOF\n${changelog}EOF\n`);
}

// Export functions for testing
export { generateComprehensiveChangelog };
