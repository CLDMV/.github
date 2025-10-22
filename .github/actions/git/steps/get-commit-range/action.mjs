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
			// Use a more reliable separator pattern - newline + special marker
			allCommits = gitCommand(
				`git log ${commitRange} --pretty=format:"COMMIT_START%n%H%n%s%n%B%nAUTHOR:%an%nEMAIL:%ae%nDATE:%ad%nCOMMIT_END" --date=iso`,
				true
			);

			if (!allCommits) {
				return [];
			}

			console.log(`🔍 DEBUG: Raw git log output for ${commitRange}:`);
			console.log(allCommits);
		} else {
			console.log(`🔍 DEBUG: Using provided commit data for range: ${commitRange}`);
		}

		const commits = allCommits
			.split("COMMIT_START\n") // Split by our custom marker
			.filter((block) => block.trim()) // Remove empty blocks
			.map((commitBlock) => {
				if (!commitBlock.trim()) return null; // Skip empty blocks

				// Debug each commit block being processed
				if (DEBUG) console.log(`🔍 DEBUG: Processing commit block: "${commitBlock.substring(0, 100)}..."`);

				const lines = commitBlock.split("\n");
				if (lines.length < 6) {
					console.log(`🔍 DEBUG: Skipping malformed commit block (${lines.length} lines): "${commitBlock.substring(0, 100)}..."`);
					return null;
				}

				// Parse the structured format
				const hash = lines[0];
				const subject = lines[1];

				// Find the body (everything between subject and AUTHOR: line)
				const authorIndex = lines.findIndex((line) => line.startsWith("AUTHOR:"));
				const body = authorIndex > 2 ? lines.slice(2, authorIndex).join("\n").trim() : "";

				const author = lines[authorIndex]?.replace("AUTHOR:", "") || "";
				const email = lines[authorIndex + 1]?.replace("EMAIL:", "") || "";
				const date = lines[authorIndex + 2]?.replace("DATE:", "") || "";

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
				// Check conventional commit types FIRST (they take precedence over content-based)
				else if (type === "feat" || type === "feature") {
					category = "feature";
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → feature (conventional)`);
				} else if (type === "fix") {
					category = "fix";
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → fix (conventional)`);
				} else if (type === "chore" || type === "docs" || type === "style" || type === "refactor" || type === "test" || type === "ci") {
					category = "maintenance";
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → maintenance (conventional)`);
				}
				// Then check for content-based categorization (only if no conventional type matched)
				else if (lower.includes("fix") || lower.includes("bug") || lower.includes("patch")) {
					category = "fix";
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → fix (content-based)`);
				} else if (lower.includes("add") || lower.includes("new") || lower.includes("feature")) {
					category = "feature";
					if (DEBUG) console.log(`🔍 CATEGORY DEBUG: "${subject}" → feature (content-based)`);
				} else {
					category = "other";
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
				console.log(`⚠️ Trying to find merge base with master/main branch...`);

				// Try to find a better base by looking at the merge-base with master/main
				const masterBase = gitCommand(
					`git merge-base HEAD origin/master 2>/dev/null || git merge-base HEAD origin/main 2>/dev/null || echo ""`,
					true
				);
				if (masterBase) {
					console.log(`🔍 DEBUG: Found merge base with master/main: ${masterBase}`);
					// If the tag is older than the merge base, use the merge base
					const tagCommitTime = gitCommand(`git log -1 --format=%at ${tagCommit}`, true);
					const mergeBaseTime = gitCommand(`git log -1 --format=%at ${masterBase}`, true);

					if (parseInt(tagCommitTime) < parseInt(mergeBaseTime)) {
						console.log(`🔍 DEBUG: Tag is older than merge base, using merge base instead`);
						baseRef = masterBase;
					}
				}
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
	console.log(`🔍 DEBUG: Base ref: ${baseRef}`);
	console.log(`🔍 DEBUG: Head ref: ${HEAD_REF}`);

	// Check if there are commits in the range
	const commitCount = parseInt(gitCommand(`git rev-list --count ${commitRange}`, true) || "0");
	let hasCommits = commitCount > 0;

	if (hasCommits) {
		console.log(`✅ Found ${commitCount} commits in range`);
		if (DEBUG) {
			console.log("🔍 DEBUG: Commits in range:");
			const commits = gitCommand(`git log ${commitRange} --oneline | head -10`, true);
			console.log(commits);
		}
		// Always show first few commits for debugging
		console.log("🔍 DEBUG: First few commits in range:");
		const commitSummary = gitCommand(`git log ${commitRange} --oneline -5`, true);
		console.log(commitSummary);
	} else {
		console.log("ℹ️ No commits found in range");
		console.log(`🔍 DEBUG: This means the range ${commitRange} contains no commits`);
		console.log(`🔍 DEBUG: This could indicate:`);
		console.log(`🔍 DEBUG: - The base tag ${baseRef} is equal to or ahead of HEAD`);
		console.log(`🔍 DEBUG: - The tag was created on the current commit`);
		console.log(`🔍 DEBUG: - There's a branch/tag reference issue`);

		// Fallback: try using merge-base with master/main
		console.log("🔍 DEBUG: Trying fallback strategy with merge-base...");
		const fallbackBase = gitCommand(
			`git merge-base HEAD origin/master 2>/dev/null || git merge-base HEAD origin/main 2>/dev/null || echo ""`,
			true
		);

		if (fallbackBase && fallbackBase !== baseRef) {
			console.log(`🔍 DEBUG: Found merge-base fallback: ${fallbackBase}`);
			const fallbackRange = `${fallbackBase}..${HEAD_REF}`;
			const fallbackCount = parseInt(gitCommand(`git rev-list --count ${fallbackRange}`, true) || "0");

			if (fallbackCount > 0) {
				console.log(`🔍 DEBUG: Fallback range ${fallbackRange} has ${fallbackCount} commits`);
				console.log(`🔍 DEBUG: Using fallback range instead`);
				baseRef = fallbackBase;
				commitRange = fallbackRange;
				hasCommits = true;

				console.log("🔍 DEBUG: First few commits in fallback range:");
				const fallbackSummary = gitCommand(`git log ${fallbackRange} --oneline -5`, true);
				console.log(fallbackSummary);
			}
		}
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

	// Recalculate commit count after potential fallback
	const finalCommitCount = parseInt(gitCommand(`git rev-list --count ${commitRange}`, true) || "0");
	const finalHasCommits = finalCommitCount > 0;

	console.log(`🔍 DEBUG: Final commit count: ${finalCommitCount}`);
	console.log(`🔍 DEBUG: Final has commits: ${finalHasCommits}`);

	// Set outputs for GitHub Actions
	const outputs = [
		`last-tag=${baseRef}`,
		`commit-range=${commitRange}`,
		`has-commits=${finalHasCommits}`,
		`base-ref=${baseRef}`,
		`commit-count=${finalCommitCount}`,
		// Single JSON array of all commits with categorization
		`commits=${JSON.stringify(categorizedCommits)}`
	];

	outputs.forEach((output) => {
		appendFileSync(process.env.GITHUB_OUTPUT, output + "\n");
	});

	console.log("✅ Commit range analysis complete");
} // End main execution block
