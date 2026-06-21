import { appendFileSync, readFileSync } from "fs";
import { gitCommand } from "../../utilities/git-utils.mjs";
import { getHumanContributors } from "../../../common/utilities/bot-detection.mjs";
import { categorizeCommits } from "../get-commit-range/action.mjs";
import { filterBotCommits } from "../../../common/utilities/bot-detection.mjs";
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
const GROUP_BY_PR = process.env.GROUP_BY_PR === "true";
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
 * Neutralize JSDoc-style @tags so markdown doesn't treat them as GitHub mentions.
 * @param {string} content - Markdown content.
 * @returns {string} Content with JSDoc tags escaped.
 */
function neutralizeJsdocTagMentions(content) {
	if (!content) {
		return "";
	}

	const jsdocTags = [
		"abstract",
		"access",
		"alias",
		"async",
		"augments",
		"author",
		"borrows",
		"callback",
		"class",
		"classdesc",
		"constant",
		"constructs",
		"default",
		"deprecated",
		"description",
		"enum",
		"event",
		"example",
		"exports",
		"extends",
		"external",
		"file",
		"fires",
		"function",
		"generator",
		"global",
		"hideconstructor",
		"ignore",
		"implements",
		"inheritdoc",
		"inner",
		"instance",
		"interface",
		"kind",
		"lends",
		"license",
		"listens",
		"member",
		"memberof",
		"mixes",
		"mixin",
		"module",
		"name",
		"namespace",
		"override",
		"package",
		"param",
		"private",
		"property",
		"protected",
		"public",
		"readonly",
		"returns",
		"return",
		"see",
		"since",
		"static",
		"summary",
		"template",
		"this",
		"throws",
		"todo",
		"tutorial",
		"type",
		"typedef",
		"variation",
		"version",
		"yields",
		"yield",
		"internal"
	];

	const tagPattern = new RegExp(`@(${jsdocTags.join("|")})(?=$|[\\s.,;:!?()[\\]{}])`, "gi");
	return content.replace(tagPattern, "\\@$1");
}

/**
 * Remove co-author trailers from rendered markdown body.
 * Contributor attribution is handled in the deduped details section.
 * @param {string} content - Markdown content that may include trailers.
 * @returns {string} Content without Co-authored-by trailer lines.
 */
function stripCoAuthorTrailers(content) {
	if (!content) {
		return "";
	}

	const lines = content.replace(/\r\n/g, "\n").split("\n");
	const normalizedLines = [];

	for (const line of lines) {
		if (!/^\s*co-authored-by\s*:/i.test(line)) {
			normalizedLines.push(line);
		}
	}

	return normalizedLines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Remove existing contributor details sections from markdown.
 * This prevents duplicated contributor blocks when regenerating notes.
 * @param {string} content - Markdown content that may include contributor details blocks.
 * @returns {string} Content without contributor details sections.
 */
function stripContributorDetailsSections(content) {
	if (!content) {
		return "";
	}

	return content
		.replace(/\n?<details>\s*\n<summary>\s*👥\s*Contributors\s*<\/summary>[\s\S]*?<\/details>\s*/gi, "\n")
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
/**
 * Look up a commit's associated pull request via GitHub's REST API.
 * Returns the first associated PR number, or null when none / on error.
 * Used to annotate commit lines in the changelog with `(#N)` when the
 * commit's subject doesn't already carry the reference (e.g. commits
 * brought in by a "create a merge commit" PR rather than a rebase-merge).
 * @param {string} sha - Commit SHA.
 * @param {string} owner - Repo owner.
 * @param {string} repo - Repo name.
 * @param {string} token - GitHub token.
 * @returns {Promise<number|null>}
 */
/**
 * Filter out commits whose patch content is already on the base branch.
 *
 * Stacked PRs that target `next`/`hotfixes` can carry commits that have
 * since been merged into the target via earlier PRs — under "Create a
 * merge commit" the original commits land on the target with their
 * original SHAs preserved, so a simple `git log base..HEAD` range still
 * includes them in subsequent stacked PRs because they're not in the
 * old PR-branch's history.
 *
 * `git cherry <base> <head>` marks each commit in `base..head` with `+`
 * (patch not yet on base) or `-` (patch already on base, by patch-id).
 * Filtering out the `-` entries removes the duplicates from the rendered
 * changelog body without depending on SHA equality.
 *
 * Best-effort: any failure (e.g. ranges that can't be cherry-checked)
 * returns the input commits unchanged and logs a warning.
 *
 * @param {Array} commits
 * @param {string} commitRange - "base..head" string.
 * @returns {Array}
 */
/**
 * Drop merge commits from the changelog list. Under v4's merge-commit-only
 * policy on `next`/`hotfixes`, every merged PR leaves both a merge commit
 * (with a subject like `<PR title> (#N)`) AND the original commits intact
 * on the target branch. The merge commit is structural — it joins the two
 * histories — but it isn't a real change-bearing commit; the contributor's
 * original commits are what describe the change. Listing both produces the
 * duplicated lines we see in release PR bodies today.
 *
 * Identifies merge commits via `git rev-parse --no-merges` — or equivalently
 * `git log --merges --format=%H <range>` to enumerate the merges then filter
 * those SHAs out of the commits array. One git call total.
 *
 * Best-effort: any failure returns the input commits unchanged and logs a
 * warning. Runs before augmentCommitsWithPRRefs so the merge commits don't
 * cost API lookups.
 *
 * @param {Array} commits
 * @param {string} commitRange - "base..head" string for the merge enumeration.
 * @returns {Array}
 */
function filterMergeCommits(commits, commitRange) {
	if (!Array.isArray(commits) || commits.length === 0) return commits;
	if (!commitRange || !commitRange.includes("..")) return commits;
	try {
		// `%h` (short SHA) matches what get-commit-range stores in c.hash
		// (sliced to 7 chars). Using `%H` (full 40-char) here would silently
		// no-op the filter: mergeSet.has(c.hash) is always false when one
		// side is 40 chars and the other 7.
		const out = gitCommand(`git log --merges --format=%h ${commitRange}`, true);
		const mergeSet = new Set(
			String(out)
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean)
		);
		if (mergeSet.size === 0) return commits;
		const kept = commits.filter((c) => {
			const sha = c?.hash || c?.sha;
			if (!sha) return true;
			return !mergeSet.has(sha);
		});
		console.log(`🌳 Dropped ${commits.length - kept.length} merge commit(s) from changelog.`);
		return kept;
	} catch (err) {
		console.log(`⚠️ Merge-commit filter skipped: ${err.message}`);
		return commits;
	}
}

function filterAlreadyAppliedByPatchId(commits, commitRange) {
	if (!Array.isArray(commits) || commits.length === 0) return commits;
	if (!commitRange || !commitRange.includes("..")) return commits;
	const match = commitRange.match(/^(.+?)\.{2,3}(.+)$/);
	if (!match) return commits;
	const [, baseRef, headRef] = match;
	try {
		const out = gitCommand(`git cherry "${baseRef}" "${headRef}"`, true);
		const alreadyApplied = new Set();
		for (const line of String(out).split("\n")) {
			const m = line.match(/^-\s+([0-9a-f]{7,40})/);
			if (m) alreadyApplied.add(m[1]);
		}
		if (alreadyApplied.size === 0) return commits;
		const kept = commits.filter((c) => {
			const sha = c?.hash || c?.sha;
			if (!sha) return true;
			return !alreadyApplied.has(sha);
		});
		console.log(`🔁 Dropped ${commits.length - kept.length} commits already on ${baseRef} (by patch-id).`);
		return kept;
	} catch (err) {
		console.log(`⚠️ Patch-id dedup skipped: ${err.message}`);
		return commits;
	}
}

/**
 * Resolve a commit SHA to its introducing PR number, ignoring the long-running
 * release PR. GitHub's /commits/{sha}/pulls returns every PR a commit appears
 * in (introducing PR AND any release PR currently bundling it), in arbitrary
 * order. Picking prs[0] blindly misattributes ~half the commits to the release
 * PR; this helper filters release-style PRs (base=master, head ∈ {next,
 * hotfixes}) and prefers merged-then-oldest within what remains.
 *
 * @param {string} sha - Commit SHA (any length GitHub accepts).
 * @param {string} owner
 * @param {string} repo
 * @param {string} token - PAT or App installation token.
 * @returns {Promise<number|null>} Introducing PR number, or null on no-match / lookup failure.
 */
async function findAssociatedPullNumber(sha, owner, repo, token) {
	// Caller (augmentCommitsWithPRRefs) already validates sha/owner/repo/token,
	// so no internal precondition check — CodeQL would flag it as dead code.
	try {
		const prs = await api("GET", `/commits/${sha}/pulls`, null, { token, owner, repo });
		if (!Array.isArray(prs) || prs.length === 0) return null;

		// A commit can appear in BOTH the feature PR that introduced it AND
		// the long-running release PR (next→master / hotfixes→master) that
		// currently bundles it. GitHub returns both in arbitrary order, so
		// picking prs[0] blindly misattributes commits to the release PR ~
		// half the time and even causes the release PR to show up as a
		// "group" inside its own changelog body.
		//
		// Filter out release-style PRs so only introducing PRs remain.
		// Within what's left, prefer merged over open (the introducing PR is
		// almost always merged by the time we render), then prefer the
		// lowest number (the oldest PR — the one that actually introduced
		// the commit, in the stacked-PR case).
		const isReleasePR = (pr) => {
			const base = pr?.base?.ref;
			const head = pr?.head?.ref;
			return base === "master" && (head === "next" || head === "hotfixes");
		};
		const candidates = prs.filter((p) => !isReleasePR(p) && typeof p?.number === "number");
		if (candidates.length === 0) return null;
		candidates.sort((a, b) => {
			const aMerged = !!a.merged_at;
			const bMerged = !!b.merged_at;
			if (aMerged !== bMerged) return aMerged ? -1 : 1; // merged first
			return a.number - b.number; // older PR first
		});
		return candidates[0].number;
	} catch (err) {
		console.log(`⚠️ Could not look up PR for ${String(sha).slice(0, 7)}: ${err.message}`);
		return null;
	}
}

/**
 * For each commit, ensure its subject carries a `(#N)` PR reference. When
 * the subject already has one (rebase-merged from a feature PR), it's left
 * alone. When it doesn't, the bot queries the GitHub API to find the
 * associated PR and appends the ref. Failures are logged and ignored —
 * the changelog falls back to just the subject + sha in that case.
 *
 * Mutates and returns the same array (so categorization that already ran
 * is preserved).
 *
 * @param {Array} commits
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @returns {Promise<Array>}
 */
async function augmentCommitsWithPRRefs(commits, owner, repo, token) {
	if (!Array.isArray(commits) || commits.length === 0) return commits;
	if (!owner || !repo || !token) {
		console.log("⚠️ Skipping PR-ref augmentation (missing owner/repo/token).");
		return commits;
	}
	let augmented = 0;
	for (const c of commits) {
		if (!c || typeof c.subject !== "string") continue;
		if (/\(#\d+\)/.test(c.subject)) continue;
		const sha = c.hash || c.sha;
		if (!sha) continue;
		const prNumber = await findAssociatedPullNumber(sha, owner, repo, token);
		if (prNumber) {
			c.subject = `${c.subject} (#${prNumber})`;
			augmented++;
		}
	}
	if (augmented > 0) {
		console.log(`🔗 Augmented ${augmented} commit subject(s) with PR refs.`);
	}
	return commits;
}

/**
 * Render a section's commits grouped by their associated PR number. Each PR
 * group looks like:
 *
 *   - #48
 *     - fix(changelog): drop merge commits... (7ccdfde)
 *     - fix(changelog): another commit... (deadbee)
 *
 * PRs are sorted newest-first by number. Commits that don't carry a `(#N)`
 * ref — direct pushes to the integration branch, augmentation failures —
 * are emitted at the bottom of the section as flat bullets.
 *
 * @param {Array} sectionCommits
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @returns {Promise<string>}
 */
async function renderSectionGroupedByPR(sectionCommits, owner, repo, token) {
	if (!Array.isArray(sectionCommits) || sectionCommits.length === 0) return "";

	const byPR = new Map();
	const noPR = [];
	for (const c of sectionCommits) {
		const subject = (c && typeof c.subject === "string" ? c.subject : "") || "";
		const m = subject.match(/\(#(\d+)\)/);
		let prNumber = m ? Number(m[1]) : null;
		// Belt-and-suspenders: when the subject doesn't already carry a
		// `(#N)` ref AND augmentCommitsWithPRRefs didn't get to inject one
		// (e.g. the token wasn't passed, or the API call failed for this
		// SHA), try the lookup one more time here. Cheap on cache hits;
		// degrades gracefully when offline.
		if (!prNumber && owner && repo && token) {
			const sha = c?.hash || c?.sha;
			if (sha) prNumber = await findAssociatedPullNumber(sha, owner, repo, token);
		}
		if (prNumber) {
			if (!byPR.has(prNumber)) byPR.set(prNumber, []);
			byPR.get(prNumber).push(c);
		} else {
			noPR.push(c);
		}
	}

	const prNumbers = Array.from(byPR.keys()).sort((a, b) => b - a);

	// Blank line between PR groups makes GitHub render each group as its own
	// "loose" list item — visually separated, but the nested commits stay
	// attached to their parent bullet. The parent `#N` is only a GitHub
	// render-time link; the children carry the searchable subject text +
	// commit SHAs.
	const groups = [];
	for (const n of prNumbers) {
		let group = `- #${n}\n`;
		for (const c of byPR.get(n)) {
			// Strip the trailing `(#N)` since it's already on the parent line.
			const subject = (c.subject || "").replace(/\s*\(#\d+\)\s*$/, "");
			group += `  - ${subject} (${c.hash})\n`;
		}
		groups.push(group);
	}

	let out = groups.join("\n");

	if (noPR.length > 0) {
		if (out.length > 0) out += "\n";
		for (const c of noPR) {
			out += `- ${c.subject} (${c.hash})\n`;
		}
	}

	return out;
}

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
 * Extract @mentions from existing contributor details sections in markdown text.
 * @param {string} body - Markdown body content.
 * @returns {Set<string>} Set of @mention strings found in contributor details blocks.
 */
function extractMentionsFromContributorDetailsSections(body) {
	const mentions = new Set();

	if (!body) {
		return mentions;
	}

	const detailsPattern = /<details>\s*\n<summary>\s*👥\s*Contributors\s*<\/summary>([\s\S]*?)<\/details>/gi;
	let detailsMatch = detailsPattern.exec(body);

	while (detailsMatch) {
		const sectionBody = detailsMatch[1] || "";
		const mentionPattern = /(^|[^\w])@([a-z\d](?:[a-z\d-]{0,38}))/gim;
		let mentionMatch = mentionPattern.exec(sectionBody);

		while (mentionMatch) {
			mentions.add(`@${mentionMatch[2]}`);
			mentionMatch = mentionPattern.exec(sectionBody);
		}

		detailsMatch = detailsPattern.exec(body);
	}

	return mentions;
}

/**
 * Collect contributor @mentions from existing contributor details sections in commits.
 * @param {Array} commits - Commit objects.
 * @returns {Set<string>} Set of @mention strings.
 */
function getExistingDetailsMentionsFromCommits(commits) {
	const mentions = new Set();

	for (const commit of commits) {
		const existingMentions = extractMentionsFromContributorDetailsSections(commit?.body || "");
		for (const mention of existingMentions) {
			mentions.add(mention);
		}
	}

	return mentions;
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
	const existingDetailsMentions = getExistingDetailsMentionsFromCommits(commits);

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

	for (const mention of existingDetailsMentions) {
		const normalizedMention = mention.toLowerCase();
		if (normalizedMention === "@internal" || normalizedMention.includes("internal") || normalizedMention.includes("[bot]")) {
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
async function generateComprehensiveChangelog(commitRange = null, commits = null, token = null, useSingleCommitMessage = false, groupByPR = false) {
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
				const cleanedBody = stripContributorDetailsSections(stripCoAuthorTrailers(removeDuplicatedLeadingSubject(subject, body)));
				let releaseNotes = subject;
				if (cleanedBody && cleanedBody.trim()) {
					releaseNotes += "\n\n" + cleanedBody.trim();
				}

				const syntheticCommit = [{ subject, body: body || "", author: "", email: "" }];
				const contributorDetails = await buildContributorMentionsDetails(syntheticCommit, token, true);
				if (contributorDetails) {
					releaseNotes += contributorDetails;
				}

				console.log(`📝 Using current commit message: ${subject}`);
				return neutralizeJsdocTagMentions(stripInternalContributorLines(releaseNotes));
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
		const cleanedBody = stripContributorDetailsSections(stripCoAuthorTrailers(removeDuplicatedLeadingSubject(commit.subject, commit.body)));

		let singleCommitChangelog = commit.subject;
		if (cleanedBody && cleanedBody.trim()) {
			singleCommitChangelog += "\n\n" + cleanedBody.trim();
		}

		singleCommitChangelog = stripInternalContributorLines(singleCommitChangelog);
		singleCommitChangelog = neutralizeJsdocTagMentions(singleCommitChangelog);
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

	// Strip the release flow's own bot-trail (version bumps, `release:` commits,
	// merge commits) and other bot noise — but KEEP dependency updates.
	// filterBotCommits keeps a commit when it is human-authored OR a
	// Dependabot/Renovate dependency bump (isDependencyUpdate); everything else
	// flagged by isBotCommit (bot author, or an automation subject like
	// 'chore: bump version' / 'release:' / 'merge …') is dropped. Dependency
	// updates are real changelog content — a release is often named after one,
	// so dropping them (the prior behaviour) left them missing from the notes
	// while the title still mentioned the bump. The PR title communicates the
	// version; the section bodies describe the human + dependency changes.
	commits = filterBotCommits(commits);

	// Drop merge commits — they're structural artifacts of the v4
	// merge-commit-only policy on next/hotfixes, not real change-bearing
	// commits. The contributor's original commits already describe the
	// change; listing the merge commit too duplicates every entry.
	commits = filterMergeCommits(commits, range);

	// Drop commits whose patch is already on the base branch. Happens for
	// stacked PRs targeting `next`/`hotfixes`: an earlier PR in the stack
	// has merged via "Create a merge commit", so its commits are already
	// on the target with their original SHAs, but they still appear in the
	// later PR's base..HEAD range. Patch-id dedup (via `git cherry`)
	// removes them from the rendered changelog without affecting the
	// release-to-master changelog (where master has no equivalent patches
	// for commits in master..next, so the dedup is a no-op there).
	commits = filterAlreadyAppliedByPatchId(commits, range);

	// Annotate each commit's subject with its associated PR reference
	// `(#N)` whenever possible. Rebase-merged commits already carry the
	// ref because GitHub appends it on merge; commits that landed via
	// "Create a merge commit" don't, so the bot looks them up via
	// /commits/{sha}/pulls. Augmentation is best-effort: API failures
	// or absent owner/repo/token degrade gracefully to the un-annotated
	// subject.
	const [augOwner, augRepo] = (GITHUB_REPOSITORY || "").split("/");
	commits = await augmentCommitsWithPRRefs(commits, augOwner, augRepo, token);

	/**
	 * Emit a section's commit list. When groupByPR is on, commits are grouped
	 * under their PR number with each commit as an indented child. Otherwise
	 * the original flat `- subject (hash)` form is preserved.
	 * @param {Array} sectionCommits
	 * @returns {Promise<string>}
	 */
	async function renderSection(sectionCommits) {
		if (groupByPR) {
			return renderSectionGroupedByPR(sectionCommits, augOwner, augRepo, token);
		}
		let out = "";
		for (const c of sectionCommits) {
			out += `- ${c.subject} (${c.hash})\n`;
		}
		return out;
	}

	// Breaking Changes - use proper categorization (merge commits are already categorized separately)
	changelog += "### 💥 Breaking Changes\n";
	const breakingCommits = commits.filter((c) => c.category === "breaking" || c.isBreaking);
	if (breakingCommits.length > 0) {
		changelog += await renderSection(breakingCommits);
	} else {
		changelog += "_No breaking changes_\n";
	}
	changelog += "\n";

	// Features - use proper categorization (exclude merge commits)
	changelog += "### ✨ Features\n";
	const featureCommits = commits.filter((c) => c.category === "feature");
	if (featureCommits.length > 0) {
		changelog += await renderSection(featureCommits);
	} else {
		changelog += "_No new features_\n";
	}
	changelog += "\n";

	// Bug Fixes - use proper categorization (exclude merge commits)
	changelog += "### 🐛 Bug Fixes\n";
	const fixCommits = commits.filter((c) => c.category === "fix");
	if (fixCommits.length > 0) {
		changelog += await renderSection(fixCommits);
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
		changelog += await renderSection(otherCommits);
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
		changelog += await renderSection(releaseCommits);
		changelog += "\n";
	}

	const contributorDetails = await buildContributorMentionsDetails(commits, token, false);
	if (contributorDetails) {
		changelog += contributorDetails + "\n";
	}

	return neutralizeJsdocTagMentions(changelog);
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

		const changelog = await generateComprehensiveChangelog(commitRange, commits, GITHUB_TOKEN, USE_SINGLE_COMMIT_MESSAGE, GROUP_BY_PR);
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
