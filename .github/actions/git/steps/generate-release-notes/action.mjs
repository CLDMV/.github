import { execSync } from "child_process";
import { writeFileSync, appendFileSync } from "fs";

// Get inputs from environment
const VERSION = process.env.VERSION;
const COMMIT_RANGE = process.env.COMMIT_RANGE;
const LAST_TAG = process.env.LAST_TAG;
const HAS_COMMITS = process.env.HAS_COMMITS === "true";
const PACKAGE_NAME = process.env.PACKAGE_NAME;
const PACKAGE_MANAGER = process.env.PACKAGE_MANAGER;

console.log(`📋 Generating release notes for version: ${VERSION}`);
console.log(`📋 Commit range: ${COMMIT_RANGE}`);
console.log(`📋 Base tag: ${LAST_TAG}`);

/**
 * Helper function to execute git commands safely
 * @param {string} grepPattern - Pattern to search for in commit messages
 * @param {string} format - Git log format string
 * @param {number} limit - Maximum number of results
 * @returns {string} Formatted commit lines
 */
function gitLog(grepPattern, format = "- %s (%h)", limit = 10) {
	try {
		const cmd = `git log ${COMMIT_RANGE} --grep="${grepPattern}" --pretty=format:"${format}" | head -${limit}`;
		console.log(`🔍 DEBUG: Executing: ${cmd}`);
		const result = execSync(cmd, { encoding: "utf8" }).trim();
		console.log(`🔍 DEBUG: Result: ${result || "(empty)"}`);
		return result;
	} catch (error) {
		console.log(`🔍 DEBUG: Git command failed: ${error.message}`);
		return "";
	}
}

/**
 * Helper function to check if commit message contains keywords
 * @param {string[]} keywords - Keywords to search for
 * @param {string[]} excludePatterns - Patterns to exclude
 * @returns {string} Formatted commit lines
 */
function getCommitsByContent(keywords, excludePatterns = []) {
	try {
		const allCommits = execSync(`git log ${COMMIT_RANGE} --pretty=format:"%s (%h)"`, { encoding: "utf8" }).trim();
		if (!allCommits) return "";

		const commits = allCommits.split("\n");
		const filtered = commits.filter((commit) => {
			// Check if commit contains any of the keywords
			const hasKeyword = keywords.some((keyword) => commit.toLowerCase().includes(keyword.toLowerCase()));

			// Check if commit should be excluded
			const shouldExclude = excludePatterns.some((pattern) => commit.toLowerCase().includes(pattern.toLowerCase()));

			return hasKeyword && !shouldExclude;
		});

		return filtered.map((commit) => `- ${commit}`).join("\n");
	} catch (error) {
		console.log(`🔍 DEBUG: Content search failed: ${error.message}`);
		return "";
	}
}

let releaseNotes = "## 🚀 What's Changed\n\n";

if (!HAS_COMMITS) {
	console.log("ℹ️ No commits found in range - this may be a re-release or tag-only release");
	releaseNotes += "_No new commits since last release_\n";
} else {
	// Debug: Show all commits in range
	try {
		const allCommits = execSync(`git log ${COMMIT_RANGE} --pretty=format:"%h %s"`, { encoding: "utf8" });
		console.log("🔍 DEBUG: All commits in range:");
		console.log(allCommits);
	} catch (error) {
		console.log("🔍 DEBUG: Could not list commits");
	}

	// Breaking Changes
	releaseNotes += "### 💥 Breaking Changes\n";
	const breakingType = gitLog("!");
	const breakingBody = gitLog("BREAKING CHANGE");
	const breakingRelease = getCommitsByContent(["break"], ["fix", "patch", "add", "feature"]);

	const hasBreaking = breakingType || breakingBody || breakingRelease;
	if (hasBreaking) {
		if (breakingType) releaseNotes += breakingType + "\n";
		if (breakingBody) releaseNotes += breakingBody + "\n";
		if (breakingRelease) releaseNotes += breakingRelease + "\n";
	} else {
		releaseNotes += "_No breaking changes_\n";
	}
	releaseNotes += "\n";

	// Features
	releaseNotes += "### ✨ Features\n";
	const featType = gitLog("^feat:");
	const featRelease = getCommitsByContent(["add", "new", "feature"], ["fix", "patch", "break"]);

	const hasFeatures = featType || featRelease;
	if (hasFeatures) {
		if (featType) releaseNotes += featType + "\n";
		if (featRelease) releaseNotes += featRelease + "\n";
	} else {
		releaseNotes += "_No new features_\n";
	}
	releaseNotes += "\n";

	// Bug Fixes
	releaseNotes += "### 🐛 Bug Fixes\n";
	const fixType = gitLog("^fix:");
	const fixRelease = getCommitsByContent(["fix", "bug", "patch"], ["add", "feature", "break", "new"]);

	console.log(`🔍 DEBUG: Fix type commits: ${fixType || "(none)"}`);
	console.log(`🔍 DEBUG: Fix release commits: ${fixRelease || "(none)"}`);

	const hasFixes = fixType || fixRelease;
	if (hasFixes) {
		if (fixType) releaseNotes += fixType + "\n";
		if (fixRelease) releaseNotes += fixRelease + "\n";
	} else {
		releaseNotes += "_No bug fixes_\n";
	}
	releaseNotes += "\n";

	// Other Changes - commits that don't fit the above categories
	releaseNotes += "### 🔧 Other Changes\n";
	try {
		const allCommits = execSync(`git log ${COMMIT_RANGE} --pretty=format:"%s (%h)"`, { encoding: "utf8" }).trim();
		if (allCommits) {
			const commits = allCommits.split("\n");
			const otherCommits = commits.filter((commit) => {
				const lower = commit.toLowerCase();
				// Exclude maintenance/internal commits
				if (
					lower.includes("chore:") ||
					lower.includes("docs:") ||
					lower.includes("style:") ||
					lower.includes("refactor:") ||
					lower.includes("test:") ||
					lower.includes("ci:")
				) {
					return false;
				}
				// Exclude already categorized commits
				if (lower.includes("feat:") || lower.includes("fix:") || lower.includes("!") || lower.includes("breaking change")) {
					return false;
				}
				// Exclude release commits that were already categorized
				if (
					lower.includes("release") &&
					(lower.includes("fix") ||
						lower.includes("bug") ||
						lower.includes("patch") ||
						lower.includes("add") ||
						lower.includes("feature") ||
						lower.includes("break"))
				) {
					return false;
				}
				return true;
			});

			if (otherCommits.length > 0) {
				releaseNotes +=
					otherCommits
						.slice(0, 5)
						.map((commit) => `- ${commit}`)
						.join("\n") + "\n";
			} else {
				releaseNotes += "_No other changes_\n";
			}
		} else {
			releaseNotes += "_No other changes_\n";
		}
	} catch (error) {
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
