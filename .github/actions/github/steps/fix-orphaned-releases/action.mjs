#!/usr/bin/env node

/**
 * Fix Orphaned Releases Action
 * Detects and fixes GitHub releases that are missing their associated tags
 */

import { writeFileSync } from "fs";
import { gitCommand } from "../../../git/utilities/git-utils.mjs";
import { importGpgIfNeeded, configureGitIdentity, ensureGitAuthRemote } from "../../api/_api/gpg.mjs";
import { api, parseRepo } from "../../api/_api/core.mjs";

const DEBUG = process.env.INPUT_DEBUG === "true";
const GITHUB_TOKEN = process.env.INPUT_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const GPG_ENABLED = process.env.INPUT_GPG_ENABLED === "true";
const TAGGER_NAME = process.env.INPUT_TAGGER_NAME || "CLDMV Bot";
const TAGGER_EMAIL = process.env.INPUT_TAGGER_EMAIL || "cldmv-bot@users.noreply.github.com";
const GPG_PRIVATE_KEY = process.env.INPUT_GPG_PRIVATE_KEY || "";
const GPG_PASSPHRASE = process.env.INPUT_GPG_PASSPHRASE || "";

console.log("🔍 Checking for orphaned releases...");

if (DEBUG) {
	console.log("🐛 Debug mode enabled");
	console.log(`🔑 Token available: ${GITHUB_TOKEN && GITHUB_TOKEN.trim() ? "Yes" : "No"}`);
	console.log(`📦 Repository: ${process.env.GITHUB_REPOSITORY || "Not set"}`);
	console.log(`🔍 Environment variables check:`);
	console.log(`  - INPUT_GITHUB_TOKEN: ${process.env.INPUT_GITHUB_TOKEN ? "Set" : "Not set"}`);
	console.log(`  - GITHUB_TOKEN: ${process.env.GITHUB_TOKEN ? "Set" : "Not set"}`);
	console.log(`  - GH_TOKEN: ${process.env.GH_TOKEN ? "Set" : "Not set"}`);
	if (process.env.INPUT_GITHUB_TOKEN) {
		console.log(`  - INPUT_GITHUB_TOKEN length: ${process.env.INPUT_GITHUB_TOKEN.length}`);
		console.log(`  - INPUT_GITHUB_TOKEN starts with: ${process.env.INPUT_GITHUB_TOKEN.substring(0, 7)}...`);
	}
	if (process.env.GITHUB_TOKEN) {
		console.log(`  - GITHUB_TOKEN length: ${process.env.GITHUB_TOKEN.length}`);
		console.log(`  - GITHUB_TOKEN starts with: ${process.env.GITHUB_TOKEN.substring(0, 7)}...`);
	}
}

/**
 * Get all releases from GitHub API using raw fetch
 */
async function getAllReleases() {
	try {
		if (!GITHUB_TOKEN || !GITHUB_TOKEN.trim()) {
			console.warn("⚠️ No GitHub token available for API access");
			return [];
		}

		if (DEBUG) {
			console.log("🔍 Fetching releases from GitHub API...");
		}

		const repository = process.env.GITHUB_REPOSITORY;
		if (!repository) {
			console.warn("⚠️ GITHUB_REPOSITORY environment variable not set");
			return [];
		}

		const { owner, repo } = parseRepo(repository);

		// Use the raw API function to get all releases
		const releases = await api("GET", "/releases", null, {
			token: GITHUB_TOKEN.trim(),
			owner,
			repo
		});

		if (!releases || releases.length === 0) {
			console.log("ℹ️ No releases found in repository");
			return [];
		}

		// Map to the format we expect
		return releases.map((release) => ({
			id: release.id,
			tag_name: release.tag_name,
			name: release.name,
			draft: release.draft,
			target_commitish: release.target_commitish
		}));
	} catch (error) {
		console.warn(`Failed to get releases: ${error.message}`);
		return [];
	}
}

/**
 * Find the target commit for a missing tag
 */
function findTargetCommit(tagName, targetCommitish) {
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
			console.warn(`Could not retrieve git log`);
		} else {
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
		}

		// Fallback: try the target_commitish from the release if no release commit found
		if (targetCommitish && targetCommitish !== "null") {
			try {
				const commit = gitCommand(`git rev-parse ${targetCommitish}`, true);
				if (commit && commit.trim()) {
					console.log(`⚠️ Using target_commitish as fallback: ${commit.trim()}`);
					console.log(`📝 Consider checking if this commit has the correct release content`);
					return commit.trim();
				}
			} catch (error) {
				if (DEBUG) {
					console.log(`Target commitish ${targetCommitish} not found: ${error.message}`);
				}
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
 * Create a missing tag using git commands (more reliable for signing)
 */
async function createMissingTag(tagName, targetCommit, releaseName) {
	try {
		console.log(`🔗 Creating missing tag ${tagName} pointing to ${targetCommit}`);

		// Setup git authentication with token (same approach as working release workflow)
		const repo = process.env.GITHUB_REPOSITORY;
		ensureGitAuthRemote(repo, GITHUB_TOKEN);

		// Configure signing and identity (exactly like working release workflow)
		const willSign = GPG_ENABLED && GPG_PRIVATE_KEY;
		const willAnnotate = GPG_ENABLED; // Always annotate when GPG is enabled
		let keyid = "";
		if (willSign) {
			keyid = importGpgIfNeeded({
				gpg_private_key: GPG_PRIVATE_KEY,
				gpg_passphrase: GPG_PASSPHRASE
			});
		}

		configureGitIdentity({
			tagger_name: TAGGER_NAME,
			tagger_email: TAGGER_EMAIL,
			keyid,
			enableSign: willSign
		});

		// Create tag message - use release name if available, otherwise tag name
		const tagMessage = releaseName && releaseName !== "null" ? releaseName : tagName;

		// Test permissions first by trying to fetch refs (lightweight test)
		try {
			gitCommand(`git ls-remote --heads origin`, true);
			if (DEBUG) {
				console.log("✅ Git remote access confirmed");
			}
		} catch (remoteError) {
			console.error(`❌ Cannot access remote repository: ${remoteError.message}`);
			return false;
		}

		// Create the tag locally using same pattern as working release workflow
		if (willSign) {
			console.log(`🔐 Creating signed tag: git tag -s -f -m "${tagMessage}" ${tagName} ${targetCommit}`);
			// Use temp file for message to handle multiline content properly
			const tempFile = `/tmp/tag-message-${Date.now()}.txt`;
			writeFileSync(tempFile, tagMessage, "utf8");
			gitCommand(`git tag -s -f -F "${tempFile}" ${tagName} ${targetCommit}`);
			try {
				require("fs").unlinkSync(tempFile);
			} catch {}
		} else if (willAnnotate) {
			console.log(`🏷️ Creating annotated tag: git tag -a -f -m "${tagMessage}" ${tagName} ${targetCommit}`);
			// Use temp file for message to handle multiline content properly
			const tempFile = `/tmp/tag-message-${Date.now()}.txt`;
			writeFileSync(tempFile, tagMessage, "utf8");
			gitCommand(`git tag -a -f -F "${tempFile}" ${tagName} ${targetCommit}`);
			try {
				require("fs").unlinkSync(tempFile);
			} catch {}
		} else {
			console.log(`🏷️ Creating lightweight tag: git tag -f ${tagName} ${targetCommit}`);
			gitCommand(`git tag -f ${tagName} ${targetCommit}`);
		}

		// Push using force push (same as working workflow) - this must succeed
		console.log(`🚀 Pushing tag to remote: git push origin +refs/tags/${tagName}`);
		const pushResult = gitCommand(`git push origin +refs/tags/${tagName}`, false);
		
		// Check if push actually succeeded (gitCommand returns empty string on failure)
		if (pushResult === "") {
			throw new Error(`Failed to push tag ${tagName} to remote`);
		}
		
		console.log(`✅ Successfully created and pushed tag ${tagName}`);
		return true;
	} catch (error) {
		console.error(`❌ Failed to create tag ${tagName}: ${error.message}`);

		// Clean up local tag if remote push failed
		try {
			gitCommand(`git tag -d ${tagName}`, true);
			console.log(`🧹 Cleaned up local tag ${tagName}`);
		} catch (cleanupError) {
			// Ignore cleanup errors
		}

		// Check for common permission issues
		if (error.message.includes("403") || error.message.includes("Permission") || error.message.includes("denied")) {
			console.error(`💡 Push failed due to insufficient permissions.`);
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
	const failedReleases = [];

	for (const release of releases) {
		const { tag_name: tagName, name: releaseName, target_commitish: targetCommitish } = release;

		if (!tagName || tagName === "null") {
			console.warn(`⚠️ Skipping release without tag name: ${releaseName || "unnamed"}`);
			continue;
		}

		console.log(`🔍 Checking release: ${releaseName || tagName} (tag: ${tagName})`);

		// Check if tag exists
		const tagRef = gitCommand(`git rev-parse refs/tags/${tagName}`, true);
		if (tagRef && tagRef.trim()) {
			console.log(`✅ Tag ${tagName} exists`);

			// Verify the tag points to the expected commit if we have a target
			if (targetCommitish && targetCommitish !== "null" && targetCommitish !== "master") {
				const expectedCommit = gitCommand(`git rev-parse ${targetCommitish}`, true);
				if (expectedCommit && expectedCommit.trim() && expectedCommit.trim() !== tagRef.trim()) {
					console.log(`⚠️ Tag ${tagName} exists but points to different commit`);
					console.log(`   Current: ${tagRef.trim()}`);
					console.log(`   Expected: ${expectedCommit.trim()}`);
				}
			}

			continue;
		}

		// If we get here, the tag doesn't exist (either empty result or command failed)
		console.log(`🚨 Found orphaned release: ${releaseName || tagName} (missing tag: ${tagName})`);

		// Find the target commit
		const targetCommit = findTargetCommit(tagName, targetCommitish);
		if (!targetCommit) {
			console.error(`❌ Could not find target commit for tag ${tagName}`);
			failedReleases.push(`${tagName} (no target commit found)`);
			continue;
		}

		// Create the missing tag
		if (await createMissingTag(tagName, targetCommit, releaseName)) {
			fixedCount++;
			fixedReleases.push(`${tagName} → ${targetCommit.substring(0, 7)}`);
		} else {
			failedReleases.push(`${tagName} → ${targetCommit.substring(0, 7)} (permissions issue)`);
		}
	}

	// Console summary
	console.log(`\n📊 Tag Health Summary:`);
	console.log(`   Total releases processed: ${releases.length}`);
	console.log(`   Orphaned releases fixed: ${fixedCount}`);
	console.log(`   Orphaned releases failed: ${failedReleases.length}`);

	if (fixedReleases.length > 0) {
		console.log(`\n✅ Successfully created tags:`);
		fixedReleases.forEach((tag) => console.log(`   ${tag}`));
	}

	if (failedReleases.length > 0) {
		console.log(`\n❌ Failed to create tags:`);
		failedReleases.forEach((tag) => console.log(`   ${tag}`));

		console.log(`\n💡 Most failures are due to insufficient GitHub App permissions.`);
		console.log(`   Ensure the GitHub App has 'Contents: Write' and 'Actions: Write' permissions.`);
	}

	// Generate summary
	let summaryJson;
	if (fixedCount > 0) {
		const lines = fixedReleases.map((fix) => `- ✅ **Fixed**: \`${fix}\``);
		if (failedReleases.length > 0) {
			lines.push(...failedReleases.map((fail) => `- ❌ **Failed**: \`${fail}\``));
		}
		summaryJson = {
			title: "📦 Orphaned Release Analysis",
			description: `Fixed ${fixedCount} releases, ${failedReleases.length} failed due to permissions.`,
			fixed_count: fixedCount,
			lines,
			stats_template: "📦 Orphaned release fixes: {count}",
			notes: [
				`Successfully recreated ${fixedCount} missing tag(s) for orphaned releases`,
				...(failedReleases.length > 0 ? [`${failedReleases.length} tags failed due to insufficient permissions`] : [])
			]
		};
	} else if (failedReleases.length > 0) {
		const lines = failedReleases.map((fail) => `- ❌ **Failed**: \`${fail}\``);
		summaryJson = {
			title: "📦 Orphaned Release Analysis",
			description: "Found orphaned releases but failed to fix due to permissions.",
			fixed_count: 0,
			lines,
			stats_template: "📦 Orphaned release fixes: {count}",
			notes: [`${failedReleases.length} orphaned releases found but GitHub App lacks required permissions`]
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

	// Final status
	if (failedReleases.length > 0) {
		console.log(`❌ Failed to fix ${failedReleases.length} orphaned releases due to permissions`);
		process.exit(1); // Exit with failure for proper error reporting
	} else {
		console.log(`✅ Fixed ${fixedCount} orphaned releases`);
	}
}

// Run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error("❌ Action failed:", error);
		process.exit(1);
	});
}
