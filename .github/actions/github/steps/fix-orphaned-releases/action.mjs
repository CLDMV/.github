#!/usr/bin/env node

/**
 * Fix Orphaned Releases Action
 * Detects and fixes GitHub releases that are missing their associated tags
 */

import { writeFileSync } from "fs";
import { gitCommand } from "../../../git/utilities/git-utils.mjs";
import { importGpgIfNeeded, configureGitIdentity } from "../../api/_api/gpg.mjs";
import { api, parseRepo } from "../../api/_api/core.mjs";
import { createAnnotatedTag, createRefForTagObject, createRefToCommit } from "../../api/_api/tag.mjs";

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
 * Create a missing tag using GitHub API
 */
async function createMissingTag(tagName, targetCommit, releaseName) {
	try {
		console.log(`🔗 Creating missing tag ${tagName} pointing to ${targetCommit}`);

		// Configure git identity for local operations
		configureGitIdentity({
			tagger_name: TAGGER_NAME,
			tagger_email: TAGGER_EMAIL,
			keyid: "",
			enableSign: false
		});

		// Create tag message - use release name if available, otherwise tag name
		const tagMessage = releaseName && releaseName !== "null" ? releaseName : tagName;

		const repository = process.env.GITHUB_REPOSITORY;
		if (!repository) {
			throw new Error("GITHUB_REPOSITORY environment variable not set");
		}

		const { owner, repo } = parseRepo(repository);

		// Set up tagger info for annotated tags
		const tagger = {
			name: TAGGER_NAME,
			email: TAGGER_EMAIL,
			date: new Date().toISOString()
		};

		// Set up GPG if enabled (for local tag creation)
		let keyid = "";
		if (GPG_ENABLED && GPG_PRIVATE_KEY) {
			keyid = importGpgIfNeeded({
				gpg_private_key: GPG_PRIVATE_KEY,
				gpg_passphrase: GPG_PASSPHRASE
			});
		}

		// Use GitHub API to create the tag directly - this bypasses workflow file protection
		try {
			if (GPG_ENABLED && GPG_PRIVATE_KEY && keyid) {
				console.log("🔐 Creating signed annotated tag via GitHub API");

				// Create annotated tag object first
				const tagObject = await createAnnotatedTag({
					token: GITHUB_TOKEN.trim(),
					repo: repository,
					tag: tagName,
					message: tagMessage,
					objectSha: targetCommit,
					tagger
				});

				// Create the ref pointing to the tag object
				await createRefForTagObject({
					token: GITHUB_TOKEN.trim(),
					repo: repository,
					tag: tagName,
					tagObjectSha: tagObject.sha
				});
			} else {
				console.log("🏷️ Creating lightweight tag via GitHub API");

				// Create lightweight tag (ref pointing directly to commit)
				await createRefToCommit({
					token: GITHUB_TOKEN.trim(),
					repo: repository,
					tag: tagName,
					commitSha: targetCommit
				});
			}

			console.log(`✅ Successfully created tag ${tagName} via GitHub API`);
			return true;
		} catch (apiError) {
			console.error(`❌ GitHub API tag creation failed: ${apiError.message}`);

			if (DEBUG) {
				console.log(`⚠️ Falling back to git push method`);
			}

			// Fallback: create tag locally and push
			let tagCommand;
			if (GPG_ENABLED && GPG_PRIVATE_KEY && keyid) {
				console.log("🔐 Creating signed tag locally");
				tagCommand = `git tag -s -a ${tagName} ${targetCommit} -m "${tagMessage}"`;
			} else {
				console.log("🏷️ Creating unsigned annotated tag locally");
				tagCommand = `git tag -a ${tagName} ${targetCommit} -m "${tagMessage}"`;
			}

			gitCommand(tagCommand, true);
			gitCommand(`git push origin ${tagName}`, false);

			console.log(`✅ Successfully created and pushed tag ${tagName} via git push fallback`);
			return true;
		}
	} catch (error) {
		console.error(`❌ Failed to create tag ${tagName}: ${error.message}`);

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
		const tagRef = gitCommand(`git rev-parse refs/tags/${tagName}`, true);
		if (tagRef && tagRef.trim()) {
			console.log(`✅ Tag ${tagName} exists`);
			continue;
		}

		// If we get here, the tag doesn't exist (either empty result or command failed)
		console.log(`🚨 Found orphaned release: ${releaseName || tagName} (missing tag: ${tagName})`);

		// Find the target commit
		const targetCommit = findTargetCommit(tagName, targetCommitish);
		if (!targetCommit) {
			console.error(`❌ Could not find target commit for tag ${tagName}`);
			continue;
		}

		// Create the missing tag
		if (await createMissingTag(tagName, targetCommit, releaseName)) {
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
