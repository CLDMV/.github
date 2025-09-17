import { appendFileSync } from "fs";
import { gitCommand } from "../../utilities/git-utils.mjs";
import { debugLog } from "../../../common/common/core.mjs";

// Global DEBUG flag - read from environment
const DEBUG = process.env.DEBUG === "true";

/**
 * Categorize commits based on conventional commit patterns and content
 * @param {string} commitRange - Git commit range to analyze
 * @param {string|null} allCommits - Optional pre-existing commit data (for testing)
 * @returns {Array} Array of commit objects with categorization
 */
export function categorizeCommits(commitRange, allCommits = null) {
	try {
		if (!allCommits) {
			console.log(`🔍 DEBUG: About to execute git log for range: ${commitRange}`);
			// Use NULL separators for reliable parsing - much cleaner than custom separators
			allCommits = gitCommand(`git log ${commitRange} --pretty=format:"%H%x00%s%x00%B%x00%an%x00%ae%x00%ad%x00" --date=iso`, true);

			if (!allCommits) {
				return [];
			}

			console.log(`🔍 DEBUG: Raw git log output for ${commitRange}:`);
			console.log(allCommits);
		} else {
			console.log(`🔍 DEBUG: Using provided commit data for range: ${commitRange}`);
		}

		const commits = allCommits
			.split("\x00\x00") // Split by double NULL to separate commits
			.map((commitBlock) => {
				if (!commitBlock.trim()) return null; // Skip empty blocks

				// Debug each commit block being processed
				if (DEBUG) console.log(`🔍 DEBUG: Processing commit block: "${commitBlock.substring(0, 100)}..."`);

				const parts = commitBlock.split("\x00"); // Split by single NULL for fields
				if (parts.length < 6) {
					console.log(`🔍 DEBUG: Skipping malformed commit block (${parts.length} parts): "${commitBlock.substring(0, 100)}..."`);
					return null;
				}

				const [hash, subject, body, author, email, date] = parts;

				// Debug the parsed parts
				if (DEBUG)
					console.log(
						`🔍 DEBUG: Parsed parts - hash: "${hash}", subject: "${subject}", body: "${body ? body.substring(0, 50) + "..." : "empty"}"`
					);

				// Validate required fields
				if (!hash || !subject) {
					console.log(`🔍 DEBUG: Skipping commit with missing hash or subject: "${commitBlock.substring(0, 100)}..."`);
					return null;
				}

				// Extra safety check before toLowerCase
				if (typeof subject !== "string") {
					console.log(`🔍 DEBUG: Subject is not a string: ${typeof subject}, value:`, subject);
					return null;
				}

				const lower = subject.toLowerCase();

				let category = "other";
				let type = null;
				let scope = null;
				let isBreaking = false;

				// Skip merge commits - they shouldn't be in changelogs
				if (
					subject.startsWith("Merge ") ||
					subject.includes("merge conflict") ||
					subject.toLowerCase().includes("resolve conflict") ||
					/^Merge branch '.+' into .+$/.test(subject) ||
					/^Merge pull request #\d+/.test(subject)
				) {
					category = "merge";
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → merge (skipped from changelog)`);
				}

				// Parse conventional commit format
				const conventionalMatch = subject.match(/^(\w+)(\([^)]+\))?(!)?:\s*(.+)/);
				if (conventionalMatch) {
					type = conventionalMatch[1];
					scope = conventionalMatch[2] ? conventionalMatch[2].slice(1, -1) : null; // Remove parentheses
					isBreaking = !!conventionalMatch[3];

					if (DEBUG) {
						console.log(`🔍 REGEX DEBUG: "${subject}" → type: "${type}", scope: "${scope}", isBreaking: ${isBreaking}`);
					}
				} else {
					if (DEBUG) {
						console.log(`🔍 REGEX DEBUG: "${subject}" → NO MATCH`);
					}
				}

				// Determine category - order matters!
				// First check for release commits - these should be excluded entirely
				if (type === "release" || lower.startsWith("release:") || lower.startsWith("release!:")) {
					category = "maintenance";
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → maintenance (release commit)`);
				}
				// Then check for breaking changes (but not release commits)
				else if ((isBreaking || lower.includes("breaking change") || lower.includes("break")) && type !== "release") {
					category = "breaking";
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → breaking`);
				}
				// Then check for content-based categorization (takes precedence over type)
				else if (lower.includes("fix") || lower.includes("bug") || lower.includes("patch")) {
					category = "fix";
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → fix (content-based)`);
				} else if (lower.includes("add") || lower.includes("new") || lower.includes("feature")) {
					category = "feature";
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → feature (content-based)`);
				}
				// Then check conventional commit types
				else if (type === "feat") {
					category = "feature";
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → feature (conventional)`);
				} else if (type === "fix") {
					category = "fix";
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → fix (conventional)`);
				} else if (type === "chore" || type === "docs" || type === "style" || type === "refactor" || type === "test" || type === "ci") {
					category = "maintenance";
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → maintenance (conventional)`);
				} else {
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → other (default)`);
				}

				return {
					hash: hash.substring(0, 7), // Short hash
					subject,
					body: body || "", // Body may be empty
					author,
					email,
					date,
					category,
					type,
					scope,
					isBreaking
				};
			})
			.filter((commit) => commit !== null); // Remove null entries from malformed lines

		// Debug logging for each commit's categorization
		if (DEBUG) {
			console.log("🔍 DEBUG: Individual commit categorization:");
			commits.forEach((commit) => {
				console.log(`  ${commit.hash}: "${commit.subject}" → ${commit.category} (type: ${commit.type}, breaking: ${commit.isBreaking})`);
			});
		}

		return commits;
	} catch (error) {
		console.log(`🔍 DEBUG: Commit categorization failed: ${error.message}`);
		return [];
	}
}

// Main logic - only run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	// Get inputs from environment
	const HEAD_REF = process.env.HEAD_REF || "HEAD";
	const BASE_REF_OVERRIDE = process.env.BASE_REF_OVERRIDE;
	const EXCLUDE_VERSION = process.env.EXCLUDE_VERSION;

	debugLog(`Getting commit range for ${HEAD_REF}`);
	debugLog(`head-ref=${HEAD_REF}`);
	debugLog(`base-ref override=${BASE_REF_OVERRIDE || "(none)"}`);

	// Fetch all tags to ensure we have the complete tag history
	console.log("🔍 Fetching all tags from remote...");
	gitCommand("git fetch --tags --force", true);
	gitCommand("git fetch origin master --tags", true);
	// Only try main if master fails (some repos use main as default)
	gitCommand("git fetch origin main --tags", true);

	if (DEBUG) {
		console.log("🔍 DEBUG: Available tags after fetch:");
		const tags = gitCommand("git tag -l | sort -V | tail -10", true);
		console.log(tags);
	}

	// Determine base ref
	let baseRef;
	if (BASE_REF_OVERRIDE) {
		baseRef = BASE_REF_OVERRIDE;
		console.log(`🔍 Using override base ref: ${baseRef}`);
	} else {
		// Use the latest semantic version tag (excluding specified version if provided)
		console.log("🔍 DEBUG: Looking for latest semantic version tag...");

		let tagCommand = "git tag -l | grep -E '^v[0-9]+\\.[0-9]+\\.[0-9]+$'";
		if (EXCLUDE_VERSION) {
			console.log(`🔍 DEBUG: Excluding version ${EXCLUDE_VERSION} from tag search`);
			tagCommand += ` | grep -v '^${EXCLUDE_VERSION}$'`;
		}

		const allTags = gitCommand(tagCommand, true);
		console.log(`🔍 DEBUG: All semantic version tags found${EXCLUDE_VERSION ? ` (excluding ${EXCLUDE_VERSION})` : ""}: ${allTags}`);

		baseRef = gitCommand(tagCommand + " | sort -V | tail -1", true);
		console.log(`🔍 Latest semantic version tag found: ${baseRef || "(none)"}`);

		// Debug: Check if the tag points to a commit that exists in current branch history
		if (baseRef) {
			const tagCommit = gitCommand(`git rev-list -n 1 ${baseRef}`, true);
			const tagInHistory = gitCommand(`git merge-base --is-ancestor ${tagCommit} HEAD && echo "yes" || echo "no"`, true);
			console.log(`🔍 DEBUG: Tag ${baseRef} points to commit ${tagCommit}`);
			console.log(`🔍 DEBUG: Is tag commit in HEAD history? ${tagInHistory}`);

			if (tagInHistory === "no") {
				console.log(`⚠️ WARNING: Tag ${baseRef} points to orphaned commit ${tagCommit} (not in current branch history)`);
				console.log(`⚠️ This likely happened due to squash-and-merge after tagging`);
			}
		}
	}

	let commitRange;
	if (!baseRef) {
		console.log("⚠️ No base ref found, using initial commit");
		const initialCommit = gitCommand("git rev-list --max-parents=0 HEAD", true);
		baseRef = initialCommit;
		commitRange = `${baseRef}..${HEAD_REF}`;
	} else {
		commitRange = `${baseRef}..${HEAD_REF}`;
	}

	console.log(`📋 Commit range: ${commitRange}`);

	// Check if there are commits in the range
	const commitCount = parseInt(gitCommand(`git rev-list --count ${commitRange}`, true) || "0");
	const hasCommits = commitCount > 0;

	if (hasCommits) {
		console.log(`✅ Found ${commitCount} commits in range`);
		if (DEBUG) {
			console.log("🔍 DEBUG: Commits in range:");
			const commits = gitCommand(`git log ${commitRange} --oneline | head -10`, true);
			console.log(commits);
		}
	} else {
		console.log("ℹ️ No commits found in range");
	}

	// Categorize commits for potential future use
	const categorizedCommits = categorizeCommits(commitRange);

	if (DEBUG) {
		console.log("🔍 DEBUG: Commit categorization:");
		const counts = categorizedCommits.reduce((acc, commit) => {
			acc[commit.category] = (acc[commit.category] || 0) + 1;
			return acc;
		}, {});
		Object.entries(counts).forEach(([category, count]) => {
			console.log(`  ${category}: ${count}`);
		});
	}

	// Set outputs for GitHub Actions
	const outputs = [
		`last-tag=${baseRef}`,
		`commit-range=${commitRange}`,
		`has-commits=${hasCommits}`,
		`base-ref=${baseRef}`,
		`commit-count=${commitCount}`,
		// Single JSON array of all commits with categorization
		`commits=${JSON.stringify(categorizedCommits)}`
	];

	outputs.forEach((output) => {
		appendFileSync(process.env.GITHUB_OUTPUT, output + "\n");
	});

	console.log("✅ Commit range analysis complete");
} // End main execution block
