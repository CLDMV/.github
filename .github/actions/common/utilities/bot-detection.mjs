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
 * Check if a commit is a dependency update (Dependabot / Renovate).
 *
 * These are bot-authored but ARE meaningful changelog content — a release is
 * often named after a dependency bump — so the changelog keeps them even though
 * `isBotCommit` is true. Deliberately does NOT match the release flow's own
 * trail: "chore: bump version to X" has no "from <x> to <y>" and no deps scope,
 * so it stays filtered.
 *
 * @param {string} subject - The commit subject line.
 * @returns {boolean} True if the subject looks like a dependency update.
 */
export function isDependencyUpdate(subject) {
	if (!subject || typeof subject !== "string") return false;
	const s = subject.trim();

	// Conventional deps prefix: "deps:", "deps-dev:", "build(deps-dev):",
	// "chore(deps):", "fix(deps):", "ci(deps):" (Dependabot/Renovate).
	if (/^(?:build|chore|fix|ci|deps)\(deps[^)]*\)!?:/i.test(s)) return true;
	if (/^deps(?:-dev)?!?:/i.test(s)) return true;

	// Dependabot bump signature: "bump <pkg> from <x> to <y>" — note the
	// required "from", which excludes the release flow's "bump version to <x>".
	if (/\bbump\s+.+\sfrom\s+\S+\s+to\s+\S+/i.test(s)) return true;

	// Renovate: "update [dependency] <pkg> to v1.2.3".
	if (/\bupdate\s+(?:dependency\s+)?\S+\s+to\s+v?\d/i.test(s)) return true;

	return false;
}

/**
 * Check if a contributor identity is an internal placeholder label.
 * @param {string} author - Commit author name
 * @param {string} email - Commit author email
 * @returns {boolean} True when identity is an internal placeholder
 */
export function isInternalPlaceholder(author, email) {
	const authorLower = (author || "").trim().toLowerCase();
	const emailLower = (email || "").trim().toLowerCase();

	if (!authorLower && !emailLower) {
		return false;
	}

	const internalPatterns = ["internal", "@internal", "internal[bot]"];

	if (internalPatterns.includes(authorLower) || internalPatterns.includes(emailLower)) {
		return true;
	}

	if (authorLower.startsWith("internal (") || emailLower.startsWith("internal@")) {
		return true;
	}

	return false;
}

/**
 * Filter out bot commits from an array of commits — but KEEP dependency updates.
 *
 * Bot-authored dependency bumps (Dependabot/Renovate) are real changelog
 * content, so they are retained even though `isBotCommit` is true. The release
 * flow's own trail (version bumps, `release:` commits, merge commits) has no
 * dependency-update shape and is still dropped.
 *
 * @param {Array} commits - Array of commit objects
 * @returns {Array} Human commits plus bot-authored dependency updates
 */
export function filterBotCommits(commits) {
	return commits.filter((commit) => !isBotCommit(commit) || isDependencyUpdate(commit && commit.subject));
}

/**
 * Get unique human contributors from an array of commits
 * @param {Array} commits - Array of commit objects
 * @returns {Array} Array of unique contributor objects with author and email
 */
export function getHumanContributors(commits) {
	const humanCommits = commits.filter((commit) => !isBotAuthor(commit.author, commit.email));
	const contributorMap = new Map();

	humanCommits.forEach((commit) => {
		if (isInternalPlaceholder(commit.author, commit.email)) {
			return;
		}

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
