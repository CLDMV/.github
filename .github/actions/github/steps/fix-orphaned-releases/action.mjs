#!/usr/bin/env node

/**
 * Fix Orphaned Releases Action
 * Detects and fixes GitHub releases that are missing their associated tags
 */

import { writeFileSync } from "fs";
import { gitCommand } from "../../../git/utilities/git-utils.mjs";
import { importGpgIfNeeded, configureGitIdentity } from "../../api/_api/gpg.mjs";

const DEBUG = process.env.INPUT_DEBUG === "true";
const GPG_ENABLED = process.env.INPUT_GPG_ENABLED === "true";
const TAGGER_NAME = process.env.INPUT_TAGGER_NAME || "CLDMV Bot";
const TAGGER_EMAIL = process.env.INPUT_TAGGER_EMAIL || "cldmv-bot@users.noreply.github.com";
const GPG_PRIVATE_KEY = process.env.INPUT_GPG_PRIVATE_KEY || "";
const GPG_PASSPHRASE = process.env.INPUT_GPG_PASSPHRASE || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

console.log("🔍 Checking for orphaned releases...");

/**
 * Get all releases from GitHub API
 */
async function getAllReleases() {
	try {
		// Set GH_TOKEN for GitHub CLI if we have a token
		if (GITHUB_TOKEN) {
			process.env.GH_TOKEN = GITHUB_TOKEN;
			if (DEBUG) {
				console.log("🔑 GitHub token available for API access");
			}
		} else {
			console.warn("⚠️ No GitHub token available for API access");
			return [];
		}

		if (DEBUG) {
			console.log("🔍 Fetching releases from GitHub API...");
		}

		const result = gitCommand(
			`gh api repos/\${GITHUB_REPOSITORY}/releases --paginate --jq '.[] | {id: .id, tag_name: .tag_name, name: .name, draft: .draft, target_commitish: .target_commitish}'`,
			true
		);

		if (!result || result.trim() === "" || result === "null") {
			console.log("ℹ️ No releases found in repository");
			return [];
		}

		// Parse each line as JSON
		const lines = result.split("\n").filter((line) => line.trim());
		const releases = [];
		for (const line of lines) {
			try {
				const release = JSON.parse(line);
				releases.push(release);
			} catch (error) {
				if (DEBUG) {
					console.warn(`Failed to parse release line: ${line}`);
				}
			}
		}

		return releases;
	} catch (error) {
		console.warn(`Failed to get releases: ${error.message}`);
		return [];
	}
}

/**
 * Find the target commit for a missing tag
 */
function findTargetCommit(tagName, targetCommitish) {
	// First try the target_commitish from the release
	if (targetCommitish && targetCommitish !== "null") {
		try {
			const commit = gitCommand(`git rev-parse ${targetCommitish}`, true);
			if (commit) {
				console.log(`✅ Found target commit from release: ${commit}`);
				return commit;
			}
		} catch (error) {
			if (DEBUG) {
				console.log(`Target commitish ${targetCommitish} not found: ${error.message}`);
			}
		}
	}

	// Extract version from tag name (e.g., v2.0.0 -> 2.0.0)
	const versionMatch = tagName.match(/^v?(.+)$/);
	if (!versionMatch) {
		console.warn(`Could not extract version from tag name: ${tagName}`);
		return null;
	}

	const version = versionMatch[1];
	console.log(`🔍 Searching for commit by version pattern: ${version}`);

	try {
		// Search for release commits mentioning this version with priority order:
		// 1. "release: v{version}" (exact match)
		// 2. "release: {version}" (without v)
		// 3. Any commit containing the version

		const allCommits = gitCommand(`git log --format="%H|%s" HEAD`, true);
		if (!allCommits) {
			return null;
		}

		const lines = allCommits.split("\n").filter((line) => line.trim());

		// Priority 1: Look for "release: v{version}" at start
		for (const line of lines) {
			const [sha, message] = line.split("|");
			if (message && message.startsWith(`release: v${version}`)) {
				console.log(`✅ Found commit by release pattern (v-prefix): ${sha} - "${message}"`);
				return sha;
			}
		}

		// Priority 2: Look for "release: {version}" at start
		for (const line of lines) {
			const [sha, message] = line.split("|");
			if (message && message.startsWith(`release: ${version}`)) {
				console.log(`✅ Found commit by release pattern (no v-prefix): ${sha} - "${message}"`);
				return sha;
			}
		}

		// Priority 3: Look for version anywhere in commit message
		for (const line of lines) {
			const [sha, message] = line.split("|");
			if (message && (message.includes(version) || message.includes(`v${version}`))) {
				console.log(`✅ Found commit by version mention: ${sha} - "${message}"`);
				return sha;
			}
		}

		console.warn(`Could not find commit for version ${version}`);
		return null;
	} catch (error) {
		console.warn(`Error searching for target commit: ${error.message}`);
		return null;
	}
}

/**
 * Create a missing tag
 */
function createMissingTag(tagName, targetCommit, releaseName) {
	try {
		console.log(`🔗 Creating missing tag ${tagName} pointing to ${targetCommit}`);

		// Configure git identity
		configureGitIdentity({
			tagger_name: TAGGER_NAME,
			tagger_email: TAGGER_EMAIL,
			keyid: "",
			enableSign: false
		});

		// Create tag message - use release name if available, otherwise tag name
		const tagMessage = releaseName && releaseName !== "null" ? releaseName : tagName;

		// Set up GPG if enabled
		let keyid = "";
		if (GPG_ENABLED && GPG_PRIVATE_KEY) {
			keyid = importGpgIfNeeded({
				gpg_private_key: GPG_PRIVATE_KEY,
				gpg_passphrase: GPG_PASSPHRASE
			});
		}

		// Create the tag
		let tagCommand;
		if (GPG_ENABLED && GPG_PRIVATE_KEY && keyid) {
			console.log("🔐 Creating signed tag");
			tagCommand = `git tag -s -a ${tagName} ${targetCommit} -m "${tagMessage}"`;
		} else {
			console.log("🏷️ Creating unsigned annotated tag");
			tagCommand = `git tag -a ${tagName} ${targetCommit} -m "${tagMessage}"`;
		}

		gitCommand(tagCommand, true);

		// Push the tag
		gitCommand(`git push origin ${tagName}`, true);

		console.log(`✅ Successfully created and pushed tag ${tagName}`);
		return true;
	} catch (error) {
		console.error(`❌ Failed to create/push tag ${tagName}: ${error.message}`);

		// Try to delete the local tag if it was created but push failed
		try {
			gitCommand(`git tag -d ${tagName}`, true);
		} catch (deleteError) {
			// Ignore deletion errors
		}

		return false;
	}
}

/**
 * Main execution
 */
async function main() {
	const releases = await getAllReleases();

	if (releases.length === 0) {
		const summaryJson = {
			title: "📦 Orphaned Release Analysis",
			description: "No releases found to analyze.",
			fixed_count: 0,
			lines: ["- ℹ️ **No releases found**: Repository contains no releases"],
			stats_template: "📦 Orphaned release fixes: {count}",
			notes: ["No releases exist in this repository"]
		};

		writeFileSync(process.env.GITHUB_OUTPUT, `fixed-count=0\nsummary-json=${JSON.stringify(summaryJson)}\n`, { flag: "a" });
		return;
	}

	let fixedCount = 0;
	const fixedReleases = [];

	for (const release of releases) {
		const { tag_name: tagName, name: releaseName, target_commitish: targetCommitish } = release;

		if (!tagName || tagName === "null") {
			console.warn(`⚠️ Skipping release without tag name: ${releaseName || "unnamed"}`);
			continue;
		}

		console.log(`🔍 Checking release: ${releaseName || tagName} (tag: ${tagName})`);

		// Check if tag exists
		try {
			gitCommand(`git rev-parse refs/tags/${tagName}`, true);
			console.log(`✅ Tag ${tagName} exists`);
			continue;
		} catch (error) {
			// Tag doesn't exist
		}

		console.log(`🚨 Found orphaned release: ${releaseName || tagName} (missing tag: ${tagName})`);

		// Find the target commit
		const targetCommit = findTargetCommit(tagName, targetCommitish);
		if (!targetCommit) {
			console.error(`❌ Could not find target commit for tag ${tagName}`);
			continue;
		}

		// Create the missing tag
		if (createMissingTag(tagName, targetCommit, releaseName)) {
			fixedCount++;
			fixedReleases.push(`${tagName} → ${targetCommit.substring(0, 7)}`);
		}
	}

	// Generate summary
	let summaryJson;
	if (fixedCount > 0) {
		const lines = fixedReleases.map((fix) => `- ✅ **Fixed**: \`${fix}\``);
		summaryJson = {
			title: "📦 Orphaned Release Analysis",
			description: "Fixed releases that were missing their associated tags.",
			fixed_count: fixedCount,
			lines,
			stats_template: "📦 Orphaned release fixes: {count}",
			notes: [`Successfully recreated ${fixedCount} missing tag(s) for orphaned releases`]
		};
	} else {
		summaryJson = {
			title: "📦 Orphaned Release Analysis",
			description: "All releases have their associated tags.",
			fixed_count: 0,
			lines: ["- ✅ **No issues found**: All releases have their associated tags"],
			stats_template: "📦 Orphaned release fixes: {count}",
			notes: ["All releases are properly linked to their tags"]
		};
	}

	writeFileSync(process.env.GITHUB_OUTPUT, `fixed-count=${fixedCount}\nsummary-json=${JSON.stringify(summaryJson)}\n`, { flag: "a" });
	console.log(`✅ Fixed ${fixedCount} orphaned releases`);
}

// Run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error("❌ Action failed:", error);
		process.exit(1);
	});
}
