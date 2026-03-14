import { appendFileSync, readFileSync } from "fs";
import { gitCommand } from "../../utilities/git-utils.mjs";
import { getHumanContributors, isBotAuthor } from "../../../common/utilities/bot-detection.mjs";
import { categorizeCommits } from "../get-commit-range/action.mjs";
import { api } from "../../../github/api/_api/core.mjs";

// Get inputs from environment.
// COMMITS_FILE is preferred over COMMITS_INPUT to avoid "Argument list too long" errors
// when the JSON payload is large (many commits).
const COMMITS_FILE = process.env.COMMITS_FILE;
const COMMITS_INPUT = (() => {
	if (COMMITS_FILE) {
		try {
			return readFileSync(COMMITS_FILE, "utf8");
		} catch (err) {
			console.log(`⚠️ Failed to read commits file '${COMMITS_FILE}': ${err.message}. Falling back to COMMITS_INPUT env var.`);
		}
	}
	return process.env.COMMITS_INPUT;
})();
const COMMIT_RANGE_INPUT = process.env.COMMIT_RANGE_INPUT;
const USE_SINGLE_COMMIT_MESSAGE = process.env.USE_SINGLE_COMMIT_MESSAGE === "true";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

/**
 * Remove a duplicated leading subject line from a commit body.
 * @param {string} subject - Commit subject line.
 * @param {string} body - Commit body text.
 * @returns {string} Body with duplicated leading subject removed.
 */
function removeDuplicatedLeadingSubject(subject, body) {
	if (!body || !subject) {
		return body || "";
	}

	const normalizedBody = body.replace(/\r\n/g, "\n");
	const lines = normalizedBody.split("\n");
	const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0);

	if (firstNonEmptyIndex === -1) {
		return "";
	}

	if (lines[firstNonEmptyIndex].trim().toLowerCase() !== subject.trim().toLowerCase()) {
		return body;
	}

	lines.splice(firstNonEmptyIndex, 1);
	return lines.join("\n").trim();
}

/**
 * Remove internal placeholder contributor lines from markdown release notes.
 * @param {string} content - Markdown release notes content.
 * @returns {string} Sanitized content.
 */
function stripInternalContributorLines(content) {
	if (!content) {
		return "";
	}

	const internalLinePattern = /^\s*(?:[-*]\s*)?(?:\[@?internal\]\([^)]*\)|@?internal)(?:\s*\([^)]*\))?\s*$/i;
	return content
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter((line) => !internalLinePattern.test(line))
		.join("\n")
		.trim();
}

/**
 * Rewrite co-author trailers to include GitHub @mentions and dedupe by mention.
 * Output format: Co-authored-by: @username (Name <email>)
 * @param {string} content - Markdown content that may include trailers.
 * @param {string} token - GitHub token for optional lookup.
 * @returns {Promise<string>} Content with normalized Co-authored-by lines.
 */
async function normalizeCoAuthorTrailers(content, token) {
	if (!content) {
		return "";
	}

	const lines = content.replace(/\r\n/g, "\n").split("\n");
	const normalizedLines = [];
	const seenMentions = new Set();
	const seenRawIdentities = new Set();

	for (const line of lines) {
		const match = line.match(/^\s*co-authored-by\s*:\s*(.+?)\s*<([^>]+)>\s*$/i);
		if (!match) {
			normalizedLines.push(line);
			continue;
		}

		const author = (match[1] || "").trim();
		const email = (match[2] || "").trim();
		if (isBotAuthor(author, email)) {
			continue;
		}
		const linkedAuthor = await convertAuthorToGitHubLink(author, email, token);
		const mention = toGitHubMention(linkedAuthor, author);

		if (mention) {
			const normalizedMention = mention.toLowerCase();
			if (normalizedMention === "@internal" || normalizedMention.includes("internal") || normalizedMention.includes("[bot]")) {
				continue;
			}

			if (seenMentions.has(normalizedMention)) {
				continue;
			}

			seenMentions.add(normalizedMention);
			normalizedLines.push(`Co-authored-by: ${mention} (${author} <${email}>)`);
			continue;
		}

		const rawIdentityKey = `${author.toLowerCase()}|${email.toLowerCase()}`;
		if (seenRawIdentities.has(rawIdentityKey)) {
			continue;
		}

		seenRawIdentities.add(rawIdentityKey);
		normalizedLines.push(`Co-authored-by: ${author} <${email}>`);
	}

	return normalizedLines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Convert a contributor identity to a GitHub @mention where possible.
 * @param {string} linkedAuthor - Normalized linked author string.
 * @param {string} fallbackAuthor - Raw author fallback.
 * @returns {string|null} GitHub mention (e.g. @user) or null.
 */
function toGitHubMention(linkedAuthor, fallbackAuthor) {
	const normalizedLinkedAuthor = (linkedAuthor || "").trim();
	const normalizedFallbackAuthor = (fallbackAuthor || "").trim();

	const linkMatch = normalizedLinkedAuthor.match(/^\[@([^\]]+)\]\(https:\/\/github\.com\/(?:apps\/)?[^)]+\)$/i);
	if (linkMatch) {
		return `@${linkMatch[1]}`;
	}

	if (normalizedLinkedAuthor.startsWith("@")) {
		return normalizedLinkedAuthor.split(/\s+/)[0];
	}

	if (normalizedFallbackAuthor.startsWith("@")) {
		return normalizedFallbackAuthor.split(/\s+/)[0];
	}

	return null;
}

/**
 * Extract a pull request number from release text.
 * @param {string} text - Subject/body text potentially containing PR reference.
 * @returns {number|null} Parsed PR number.
 */
function extractPullRequestNumber(text) {
	if (!text) {
		return null;
	}

	const parenMatch = text.match(/\(#(\d+)\)/);
	if (parenMatch) {
		return Number(parenMatch[1]);
	}

	const hashMatch = text.match(/(?:^|\s)#(\d+)(?:\s|$)/);
	if (hashMatch) {
		return Number(hashMatch[1]);
	}

	return null;
}

/**
 * Get contributor @mentions from a pull request's commits.
 * @param {number|null} pullNumber - Pull request number.
 * @param {string} token - GitHub API token.
 * @param {string} repository - Repository in owner/repo format.
 * @returns {Promise<Set<string>>} Set of @mention strings.
 */
async function getContributorMentionsFromPullRequest(pullNumber, token, repository) {
	const mentions = new Set();

	if (!pullNumber || !token || !repository) {
		return mentions;
	}

	try {
		let page = 1;
		const perPage = 100;

		while (true) {
			const prCommits = await api("GET", `/repos/${repository}/pulls/${pullNumber}/commits?per_page=${perPage}&page=${page}`, null, {
				token
			});

			if (!Array.isArray(prCommits) || prCommits.length === 0) {
				break;
			}

			for (const prCommit of prCommits) {
				const login = prCommit?.author?.login;
				if (!login) {
					continue;
				}

				const lowerLogin = login.toLowerCase();
				if (lowerLogin === "internal" || lowerLogin.includes("[bot]")) {
					continue;
				}

				mentions.add(`@${login}`);
			}

			if (prCommits.length < perPage) {
				break;
			}

			page += 1;
		}
	} catch (error) {
		console.warn(`Failed to load PR contributors for #${pullNumber}:`, error.message);
	}

	return mentions;
}

/**
 * Extract co-author identities from commit body text.
 * @param {string} body - Commit message body.
 * @returns {Array<{author: string, email: string}>} Co-author identities.
 */
function extractCoAuthorIdentitiesFromBody(body) {
	if (!body) {
		return [];
	}

	const identities = [];
	const coAuthorRegex = /^\s*co-authored-by\s*:\s*(.+?)\s*<([^>]+)>\s*$/gim;
	let match = coAuthorRegex.exec(body);

	while (match) {
		identities.push({
			author: (match[1] || "").trim(),
			email: (match[2] || "").trim()
		});
		match = coAuthorRegex.exec(body);
	}

	return identities;
}

/**
 * Convert co-author commit trailers into GitHub @mentions.
 * @param {Array} commits - Commit objects.
 * @param {string} token - GitHub token for optional user lookup.
 * @returns {Promise<Set<string>>} Set of @mention strings.
 */
async function getCoAuthorMentionsFromCommits(commits, token) {
	const mentions = new Set();

	for (const commit of commits) {
		const coAuthors = extractCoAuthorIdentitiesFromBody(commit?.body || "");
		for (const coAuthor of coAuthors) {
			const linkedAuthor = await convertAuthorToGitHubLink(coAuthor.author, coAuthor.email, token);
			const mention = toGitHubMention(linkedAuthor, coAuthor.author);

			if (!mention) {
				continue;
			}

			const normalizedMention = mention.toLowerCase();
			if (normalizedMention === "@internal" || normalizedMention.includes("internal") || normalizedMention.includes("[bot]")) {
				continue;
			}

			mentions.add(mention);
		}
	}

	return mentions;
}

/**
 * Build a collapsible contributors section with @mentions.
 * @param {Array} commits - Commit objects.
 * @param {string} token - GitHub token for user lookups.
 * @param {boolean} enablePullRequestLookup - Whether PR-based contributor lookup should run.
 * @returns {Promise<string>} Markdown details section or empty string.
 */
async function buildContributorMentionsDetails(commits, token, enablePullRequestLookup = false) {
	const contributors = getHumanContributors(commits);
	const uniqueMentions = new Set();
	let prMentions = new Set();
	const coAuthorMentions = await getCoAuthorMentionsFromCommits(commits, token);

	if (enablePullRequestLookup) {
		const releaseCommitWithPr = commits.find((commit) => commit?.subject && /\(#\d+\)/.test(commit.subject));
		const pullNumber = releaseCommitWithPr ? extractPullRequestNumber(releaseCommitWithPr.subject) : null;
		prMentions = await getContributorMentionsFromPullRequest(pullNumber, token, GITHUB_REPOSITORY);
	}

	for (const mention of prMentions) {
		const normalizedMention = mention.toLowerCase();
		if (normalizedMention === "@internal" || normalizedMention.includes("internal")) {
			continue;
		}

		uniqueMentions.add(mention);
	}

	for (const mention of coAuthorMentions) {
		const normalizedMention = mention.toLowerCase();
		if (normalizedMention === "@internal" || normalizedMention.includes("internal")) {
			continue;
		}

		uniqueMentions.add(mention);
	}

	for (const contributor of contributors) {
		const linkedAuthor = await convertAuthorToGitHubLink(contributor.author, contributor.email, token);
		const mention = toGitHubMention(linkedAuthor, contributor.author);

		if (!mention) {
			continue;
		}

		const normalizedMention = mention.toLowerCase();
		if (normalizedMention === "@internal" || normalizedMention.includes("internal")) {
			continue;
		}

		uniqueMentions.add(mention);
	}

	if (uniqueMentions.size === 0) {
		return "";
	}

	const mentionLines = Array.from(uniqueMentions)
		.sort((a, b) => a.localeCompare(b))
		.map((mention) => `- ${mention}`)
		.join("\n");

	return `\n\n<details>\n<summary>👥 Contributors</summary>\n\n${mentionLines}\n\n</details>`;
}

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
async function generateComprehensiveChangelog(commitRange = null, commits = null, token = null, useSingleCommitMessage = false) {
	console.log(`🔍 DEBUG: generateComprehensiveChangelog called with:`);
	console.log(`  - commitRange: ${commitRange}`);
	console.log(`  - commits: ${commits ? (Array.isArray(commits) ? commits.length + " commits" : "provided but not array") : "null"}`);
	console.log(`  - useSingleCommitMessage: ${useSingleCommitMessage}`);

	if (commits && Array.isArray(commits)) {
		console.log(
			`  - commits preview: ${commits
				.slice(0, 3)
				.map((c) => c.subject || c)
				.join(", ")}${commits.length > 3 ? "..." : ""}`
		);
	}

	// Handle edge case: if no commits provided and single commit message requested,
	// get the current commit message as release notes
	if ((!commits || commits.length === 0) && useSingleCommitMessage) {
		console.log(`📝 No commits in range but single commit message requested - using current commit`);

		try {
			const currentCommitInfo = gitCommand(`git log -1 --pretty=format:"%s|%b"`, true);
			if (currentCommitInfo) {
				const [subject, body] = currentCommitInfo.split("|");
				const cleanedBody = await normalizeCoAuthorTrailers(removeDuplicatedLeadingSubject(subject, body), token);
				let releaseNotes = subject;
				if (cleanedBody && cleanedBody.trim()) {
					releaseNotes += "\n\n" + cleanedBody.trim();
				}
				console.log(`📝 Using current commit message: ${subject}`);
				return stripInternalContributorLines(releaseNotes);
			}
		} catch (error) {
			console.log(`⚠️ Failed to get current commit message: ${error.message}`);
		}
	}
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

	if (!commits) {
		console.log(`⚠️ No commits provided, using categorizeCommits with range: ${range}`);
		commits = categorizeCommits(range);
		console.log(`📋 Categorized ${commits.length} commits from git history`);
	}

	// If only one commit AND flag is enabled (like a PR squash and merge for publish),
	// use its message directly as it's usually more descriptive than auto-generated changelog
	if (commits.length === 1 && useSingleCommitMessage) {
		const commit = commits[0];
		console.log(`📝 Single commit detected with flag enabled, using commit message as changelog`);
		const cleanedBody = await normalizeCoAuthorTrailers(removeDuplicatedLeadingSubject(commit.subject, commit.body), token);

		let singleCommitChangelog = commit.subject;
		if (cleanedBody && cleanedBody.trim()) {
			singleCommitChangelog += "\n\n" + cleanedBody.trim();
		}

		singleCommitChangelog = stripInternalContributorLines(singleCommitChangelog);
		const contributorDetails = await buildContributorMentionsDetails(commits, token, true);
		if (contributorDetails) {
			singleCommitChangelog += contributorDetails;
		}

		return singleCommitChangelog;
	}

	// Note: When there are multiple commits, we should ALWAYS generate a comprehensive
	// categorized changelog regardless of the useSingleCommitMessage flag, because users
	// need to see all the changes (fixes, features, etc.) in the PR/release notes.

	let changelog = "## 🚀 What's Changed\n\n";

	// Don't filter out release commits - they may contain useful information

	// Breaking Changes - use proper categorization (merge commits are already categorized separately)
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

	// Features - use proper categorization (exclude merge commits)
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

	// Bug Fixes - use proper categorization (exclude merge commits)
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

	// Other Changes - maintenance and other categories (but NOT release or merge commits)
	changelog += "### 🔧 Other Changes\n";
	const otherCommits = commits.filter(
		(c) => (c.category === "maintenance" || c.category === "other") && c.type !== "release" && c.category !== "merge"
	);
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

	const contributorDetails = await buildContributorMentionsDetails(commits, token, false);
	if (contributorDetails) {
		changelog += contributorDetails + "\n";
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

		const changelog = await generateComprehensiveChangelog(commitRange, commits, GITHUB_TOKEN, USE_SINGLE_COMMIT_MESSAGE);
		console.log("📄 Generated comprehensive changelog");

		// Output the changelog content using a unique delimiter
		const delimiter = `EOF_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		appendFileSync(process.env.GITHUB_OUTPUT, `changelog-content<<${delimiter}\n${changelog}\n${delimiter}\n`);
	}

	// Run the main function
	main().catch((error) => {
		console.error("Failed to generate changelog:", error);
		process.exit(1);
	});
}

// Export functions for testing
export { generateComprehensiveChangelog };
