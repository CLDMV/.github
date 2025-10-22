/**
 * Bot Detection Utilities
 *
 * Provides reliable detection of bot commits and authors to filter them out
 * from human-centric operations like contributor lists and meaningful change tracking.
 */

/**
 * Check if a commit author is a bot based on known patterns
 * @param {string} author - The commit author name
 * @param {string} email - The commit author email
 * @returns {boolean} True if the author appears to be a bot
 */
export function isBotAuthor(author, email) {
	if (!author && !email) return false;

	const authorLower = (author || "").toLowerCase();
	const emailLower = (email || "").toLowerCase();

	// Known bot author patterns
	const botAuthorPatterns = [
		"[bot]",
		"github-actions",
		"dependabot",
		"renovate",
		"greenkeeper",
		"codecov",
		"snyk-bot",
		"whitesource-bolt",
		"pyup-bot",
		"mergify",
		"semantic-release-bot",
		"release-please",
		"allcontributors"
	];

	// Known bot email patterns
	const botEmailPatterns = [
		"@dependabot.com",
		"@renovatebot.com",
		"@greenkeeper.io",
		"@codecov.io",
		"@snyk.io",
		"@whitesourcesoftware.com",
		"@pyup.io",
		"@mergify.io",
		"dependabot[bot]@users.noreply.github.com",
		"github-actions[bot]@users.noreply.github.com",
		"renovate[bot]@users.noreply.github.com"
	];

	// Check for bot patterns in author name
	for (const pattern of botAuthorPatterns) {
		if (authorLower.includes(pattern)) {
			return true;
		}
	}

	// Check for bot patterns in email
	for (const pattern of botEmailPatterns) {
		if (emailLower.includes(pattern)) {
			return true;
		}
	}

	return false;
}

/**
 * Check if a commit subject indicates an automated commit
 * @param {string} subject - The commit subject line
 * @returns {boolean} True if the commit appears to be automated
 */
export function isAutomatedCommit(subject) {
	if (!subject) return false;

	const subjectLower = subject.toLowerCase();

	// Known automated commit patterns
	const automatedPatterns = [
		"chore: bump version",
		"chore(release):",
		"merge branch",
		"merge pull request",
		"auto-generated",
		"automatically generated",
		"version bump",
		"release: ",
		"update dependencies",
		"update changelog",
		"update package-lock.json",
		"update yarn.lock"
	];

	for (const pattern of automatedPatterns) {
		if (subjectLower.startsWith(pattern) || subjectLower.includes(pattern)) {
			return true;
		}
	}

	return false;
}

/**
 * Check if a commit is from a bot (combining author and subject checks)
 * @param {Object} commit - Commit object with author, email, and subject
 * @returns {boolean} True if the commit appears to be from a bot or automated process
 */
export function isBotCommit(commit) {
	const { author, email, subject } = commit;

	return isBotAuthor(author, email) || isAutomatedCommit(subject);
}

/**
 * Filter out bot commits from an array of commits
 * @param {Array} commits - Array of commit objects
 * @returns {Array} Array of commits with bot commits filtered out
 */
export function filterBotCommits(commits) {
	return commits.filter((commit) => !isBotCommit(commit));
}

/**
 * Get unique human contributors from an array of commits
 * @param {Array} commits - Array of commit objects
 * @returns {Array} Array of unique contributor objects with author and email
 */
export function getHumanContributors(commits) {
	const humanCommits = filterBotCommits(commits);
	const contributorMap = new Map();

	humanCommits.forEach((commit) => {
		const key = `${commit.author}|${commit.email || ""}`;
		if (!contributorMap.has(key)) {
			contributorMap.set(key, {
				author: commit.author,
				email: commit.email || ""
			});
		}
	});

	return Array.from(contributorMap.values());
}
