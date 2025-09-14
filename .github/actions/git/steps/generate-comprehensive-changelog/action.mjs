import { appendFileSync } from "fs";
import { gitCommand } from "../../utilities/git-utils.mjs";
import { categorizeCommits } from "../get-commit-range/action.mjs";
import { api } from "../../../github/api/_api/core.mjs";

// Get inputs from environment
const COMMITS_INPUT = process.env.COMMITS_INPUT;
const COMMIT_RANGE_INPUT = process.env.COMMIT_RANGE_INPUT;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

/**
 * Look up GitHub username from email address using GitHub API
 * @param {string} email - Email address to look up
 * @param {string} token - GitHub API token
 * @returns {Promise<string|null>} GitHub username or null if not found
 */
async function lookupGitHubUsernameByEmail(email, token) {
	if (!email || !token) {
		return null;
	}

	try {
		// Use GitHub search API to find users by email
		// Note: This only works for public emails or emails in commits
		const searchResult = await api("GET", `/search/users?q=${encodeURIComponent(email)}+in:email`, null, { token });

		if (searchResult && searchResult.items && searchResult.items.length > 0) {
			// Return the first match (most relevant)
			return searchResult.items[0].login;
		}

		return null;
	} catch (error) {
		console.warn(`Failed to lookup username for email ${email}:`, error.message);
		return null;
	}
}

/**
 * Convert author email to GitHub username/link with API lookup
 * @param {string} author - Author name from git commit
 * @param {string} email - Author email from git commit
 * @param {string} token - GitHub API token for lookups
 * @returns {Promise<string>} GitHub user link or original name if can't convert
 */
async function convertAuthorToGitHubLink(author, email, token) {
	if (!email) {
		return author; // fallback to name if no email
	}

	// Handle GitHub noreply emails which contain the actual username
	const noreplyMatch = email.match(/^(\d+\+)?([^@]+)@users\.noreply\.github\.com$/);
	if (noreplyMatch) {
		const username = noreplyMatch[2];
		if (username.endsWith("[bot]")) {
			// Bot users
			const botName = username.replace("[bot]", "");
			return `[@${username}](https://github.com/apps/${botName})`;
		} else {
			// Regular users
			return `[@${username}](https://github.com/${username})`;
		}
	}

	// Handle GitHub app bot emails: {user-id}+{app-slug}[bot]@users.noreply.github.com
	const botMatch = email.match(/^(\d+)\+([^@]+\[bot\])@users.noreply.github\.com$/);
	if (botMatch) {
		const botUsername = botMatch[2];
		const botName = botUsername.replace("[bot]", "");
		return `[@${botUsername}](https://github.com/apps/${botName})`;
	}

	// Handle action@github.com (GitHub Actions bot)
	if (email === "action@github.com" || email === "actions@github.com") {
		return "[@github-actions[bot]](https://github.com/apps/github-actions)";
	}

	// For any other email, try GitHub API lookup
	if (token) {
		try {
			const username = await lookupGitHubUsernameByEmail(email, token);
			if (username) {
				return `[@${username}](https://github.com/${username})`;
			}
		} catch (error) {
			console.warn(`API lookup failed for ${email}:`, error.message);
		}
	}

	// Fallback to original author name with email info
	return `${author} (${email})`;
}

/**
 * Generate comprehensive changelog based on git commit history
 * @param {string} commitRange - Git commit range (e.g., "v1.0.0..HEAD")
 * @param {Array} commits - Optional pre-categorized commits array for testing
 * @param {string} token - GitHub API token for user lookups
 * @returns {Promise<string>} Generated changelog content
 */
async function generateComprehensiveChangelog(commitRange = null, commits = null, token = null) {
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

	// Other Changes - maintenance and other categories (but NOT release commits)
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

	// Release Information - show release commits that triggered this PR
	const releaseCommits = commits.filter(
		(c) => c.type === "release" || (c.category === "maintenance" && c.subject.toLowerCase().startsWith("release"))
	);
	if (releaseCommits.length > 0) {
		changelog += "### 🏷️ Release Information\n";
		releaseCommits.forEach((c) => {
			changelog += `- ${c.subject} (${c.hash})\n`;
		});
		changelog += "\n";
	}

	// Contributors - with GitHub user links based on email via API lookup
	changelog += "### 👥 Contributors\n";
	const contributorData = [...new Set(commits.map((c) => `${c.author}|${c.email || ""}`))];

	// Process contributors with API lookups
	for (const contributorStr of contributorData) {
		const [author, email] = contributorStr.split("|");
		const linkedAuthor = await convertAuthorToGitHubLink(author, email, token);
		changelog += `- ${linkedAuthor}\n`;
	}

	return changelog;
}

// Main logic - only run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	async function main() {
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

		const changelog = await generateComprehensiveChangelog(commitRange, commits, GITHUB_TOKEN);
		console.log("📄 Generated comprehensive changelog");

		// Output the changelog content
		appendFileSync(process.env.GITHUB_OUTPUT, `changelog-content<<EOF\n${changelog}EOF\n`);
	}

	// Run the main function
	main().catch((error) => {
		console.error("Failed to generate changelog:", error);
		process.exit(1);
	});
}

// Export functions for testing
export { generateComprehensiveChangelog };
