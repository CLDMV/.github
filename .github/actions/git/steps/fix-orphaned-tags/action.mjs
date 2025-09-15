#!/usr/bin/env node

/**
 * Fix Orphaned Tags
 * Fixes tags pointing to orphaned commits by re-pointing to equivalent commits
 */

import { writeFileSync } from "fs";
import { gitCommand } from "../../utilities/git-utils.mjs";
import { importGpgIfNeeded, configureGitIdentity } from "../../../github/api/_api/gpg.mjs";

console.log("🔍 DEBUG: Orphaned tags action starting...");

const DEBUG = process.env.INPUT_DEBUG === "true";
const DRY_RUN = process.env.INPUT_DRY_RUN === "true";
const TAGS_DETAILED = JSON.parse(process.env.INPUT_TAGS_DETAILED || "[]");
const TAGGER_NAME = process.env.INPUT_TAGGER_NAME || "";

console.log(`🔍 DEBUG: Processing ${TAGS_DETAILED.length} tags for orphaned analysis`);
const TAGGER_EMAIL = process.env.INPUT_TAGGER_EMAIL || "";
const GPG_ENABLED = (process.env.INPUT_GPG_ENABLED || "false").toLowerCase() === "true";
const GPG_PRIVATE_KEY = process.env.INPUT_GPG_PRIVATE_KEY || "";
const GPG_PASSPHRASE = process.env.INPUT_GPG_PASSPHRASE || "";

/**
 * Find equivalent commit in current branch for orphaned commit
 * @param {string} orphanedCommit - SHA of orphaned commit
 * @returns {string|null} SHA of equivalent commit or null if not found
 */
function findEquivalentCommit(orphanedCommit) {
	try {
		// Get the commit message and author from orphaned commit
		const orphanedMessage = gitCommand(`git log -1 --format="%s" ${orphanedCommit}`, true);
		const orphanedAuthor = gitCommand(`git log -1 --format="%an <%ae>" ${orphanedCommit}`, true);
		const orphanedDate = gitCommand(`git log -1 --format="%ct" ${orphanedCommit}`, true);

		if (!orphanedMessage) {
			console.warn(`⚠️ Could not get message for orphaned commit ${orphanedCommit}`);
			return null;
		}

		if (DEBUG) {
			console.log(`🔍 Looking for equivalent of: "${orphanedMessage}" by ${orphanedAuthor}`);
		}

		// Special handling for release commits - look for version pattern
		const releaseMatch = orphanedMessage.match(/^release:\s*(v?\d+\.\d+\.\d+)/);
		if (releaseMatch) {
			const version = releaseMatch[1];
			console.log(`🔍 Detected release commit for version ${version}, searching for pattern...`);
			
			// Search for commits containing this version in a release message
			const versionSearch = `git log --format="%H|%s|%an <%ae>|%ct" --oneline HEAD | grep -i "release.*${version}"`;
			try {
				const versionResults = gitCommand(versionSearch, true);
				if (versionResults) {
					const lines = versionResults.split("\n").filter(line => line.trim());
					for (const line of lines) {
						const parts = line.split("|");
						if (parts.length >= 2) {
							const [sha, message] = parts;
							// Check if this is a release message for the same version
							if (message.toLowerCase().includes("release") && message.includes(version)) {
								console.log(`✅ Found equivalent release commit by version pattern: ${sha} - "${message}"`);
								return sha;
							}
						}
					}
				}
			} catch (error) {
				console.log(`🔍 Version pattern search failed: ${error.message}, falling back to exact message search`);
			}
		}

		// Fallback to exact message search without author restriction
		console.log(`🔍 Searching for exact message match: "${orphanedMessage}"`);
		const allCommits = gitCommand(`git log --format="%H|%s|%an <%ae>|%ct" HEAD`, true);
		
		if (allCommits) {
			const lines = allCommits.split("\n").filter(line => line.trim());
			for (const line of lines) {
				const [sha, message, author, timestamp] = line.split("|");
				
				// Skip if it's the same commit (shouldn't happen in current branch, but safety check)
				if (sha === orphanedCommit) continue;
				
				// Check for exact message match
				if (message === orphanedMessage) {
					console.log(`✅ Found equivalent commit by exact message: ${sha} - "${message}"`);
					return sha;
				}
			}
		}

		console.warn(`⚠️ No equivalent commit found for orphaned commit ${orphanedCommit}`);
		return null;
	} catch (error) {
		console.error(`❌ Error finding equivalent commit: ${error.message}`);
		return null;
	}
}

/**
 * Fix an orphaned tag by re-pointing to equivalent commit
 * @param {object} tagObj - Tag object to fix
 * @returns {object} Updated tag object or null if failed
 */
function fixOrphanedTag(tagObj) {
	const tagName = tagObj.name;

	try {
		if (DRY_RUN) {
			console.log(`🔗 [DRY RUN] Would re-point orphaned tag ${tagName}`);

			// For dry run, just mark as no longer orphaned
			return {
				...tagObj,
				isOrphaned: false
			};
		}

		console.log(`🔗 Re-pointing orphaned tag ${tagName}...`);

		// Find equivalent commit
		const equivalentCommit = findEquivalentCommit(tagObj.commitSha);
		if (!equivalentCommit) {
			console.error(`❌ Could not find equivalent commit for orphaned tag ${tagName}`);
			return null;
		}

		// Use existing message or tag name as fallback
		const tagMessage = tagObj.message || tagName;

		// Set up bot identity and GPG if provided
		let keyid = "";
		if (GPG_ENABLED && GPG_PRIVATE_KEY) {
			keyid = importGpgIfNeeded({ gpg_private_key: GPG_PRIVATE_KEY, gpg_passphrase: GPG_PASSPHRASE });
		}

		configureGitIdentity({
			tagger_name: TAGGER_NAME,
			tagger_email: TAGGER_EMAIL,
			keyid,
			enableSign: GPG_ENABLED && GPG_PRIVATE_KEY
		});

		// Delete the existing tag locally and remotely
		gitCommand(`git tag -d ${tagName}`, true);
		gitCommand(`git push origin :refs/tags/${tagName}`, true);

		// Create new tag pointing to equivalent commit
		let tagCommand;
		if (GPG_ENABLED && GPG_PRIVATE_KEY) {
			// Always create signed annotated tags when GPG is enabled
			tagCommand = `git tag -s -a ${tagName} ${equivalentCommit} -m "${tagMessage}"`;
		} else if (tagObj.isAnnotated) {
			tagCommand = `git tag -a ${tagName} ${equivalentCommit} -m "${tagMessage}"`;
		} else {
			tagCommand = `git tag ${tagName} ${equivalentCommit}`;
		}

		gitCommand(tagCommand);

		// Push the new tag
		gitCommand(`git push origin ${tagName}`);

		console.log(`✅ Successfully re-pointed tag ${tagName} to ${equivalentCommit}`);

		// Return updated tag object
		return {
			...tagObj,
			commitSha: equivalentCommit,
			isOrphaned: false,
			isSigned: GPG_ENABLED && GPG_PRIVATE_KEY,
			isAnnotated: (GPG_ENABLED && GPG_PRIVATE_KEY) || tagObj.isAnnotated,
			tagger: TAGGER_NAME || tagObj.tagger
		};
	} catch (error) {
		console.error(`❌ Failed to fix orphaned tag ${tagName}: ${error.message}`);
		return null;
	}
}

// Initialize variables for summary generation
let fixedCount = 0;
let updatedTagsDetailed = TAGS_DETAILED;
let fixedTagsArray = [];

console.log("🔗 Checking and fixing orphaned tags...");

if (TAGS_DETAILED.length === 0) {
	console.log("ℹ️ No tags to process");

	// Set outputs
	console.log("updated-tags-detailed=[]");
	console.log("fixed-count=0");
	console.log("fixed-tags=[]");

	const githubOutput = process.env.GITHUB_OUTPUT;
	if (githubOutput) {
		writeFileSync(githubOutput, "updated-tags-detailed=[]\n" + "fixed-count=0\n" + "fixed-tags=[]\n", { flag: "a" });
	}

	// Continue to summary generation instead of exiting
	fixedCount = 0;
	updatedTagsDetailed = TAGS_DETAILED;
	fixedTagsArray = [];
	console.log("🔍 Continuing to summary generation...");
} else {
	console.log(`🔍 Analyzing ${TAGS_DETAILED.length} tags for orphaned commits...`);

	// Identify orphaned tags
	const orphanedTags = TAGS_DETAILED.filter((tagObj) => tagObj.isOrphaned);

	if (orphanedTags.length === 0) {
		console.log("✅ No orphaned tags found");

		// Set outputs - no changes needed
		const updatedTagsJson = JSON.stringify(TAGS_DETAILED);
		console.log(`updated-tags-detailed=${updatedTagsJson}`);
		console.log("fixed-count=0");
		console.log("fixed-tags=[]");

		const githubOutput = process.env.GITHUB_OUTPUT;
		if (githubOutput) {
			writeFileSync(githubOutput, `updated-tags-detailed=${updatedTagsJson}\n` + "fixed-count=0\n" + "fixed-tags=[]\n", { flag: "a" });
		}

		// Continue to summary generation instead of exiting
		fixedCount = 0;
		updatedTagsDetailed = TAGS_DETAILED;
		fixedTagsArray = [];
		console.log("🔍 Continuing to summary generation...");
	} else {
		console.log(`🔧 Found ${orphanedTags.length} orphaned tags:`);
		orphanedTags.forEach((tagObj) => {
			console.log(`  - ${tagObj.name} (points to ${tagObj.commitSha})`);
		});

		// Create a copy of the detailed tags list to update
		const updatedTagsList = [...TAGS_DETAILED];
		const fixedTags = [];

		// Fix each orphaned tag
		for (const tagObj of orphanedTags) {
			const fixedTagObj = fixOrphanedTag(tagObj);

			if (fixedTagObj) {
				// Update the tag object in the list
				const index = updatedTagsList.findIndex((t) => t.name === tagObj.name);
				if (index !== -1) {
					updatedTagsList[index] = fixedTagObj;
				}
				fixedTags.push(tagObj.name);
			}
		}

		console.log(`✅ Fixed ${fixedTags.length} orphaned tags`);

		if (DEBUG) {
			console.log("🔍 Fixed tags details:");
			fixedTags.forEach((tagName) => {
				const tagObj = updatedTagsList.find((t) => t.name === tagName);
				if (tagObj) {
					console.log(`  - ${tagName}: now points to ${tagObj.commitSha}, orphaned=${tagObj.isOrphaned}`);
				}
			});
		}

		// Set variables for summary generation
		fixedCount = fixedTags.length;
		updatedTagsDetailed = updatedTagsList;
		fixedTagsArray = fixedTags;
	}

	// Set outputs
	const updatedTagsJson = JSON.stringify(updatedTagsDetailed);
	const fixedTagsJson = JSON.stringify(fixedTagsArray);

	// Create detailed summary JSON with title, description, and pre-formatted lines
	const summaryData = {
		title: "🔗 Orphaned Tag Analysis",
		description:
			fixedTagsArray.length > 0 ? "The following orphaned tags were retargeted:" : "Analyzed version tags for orphaned references.",
		fixed_count: fixedTagsArray.length,
		lines: [],
		stats_template: "🔗 Orphaned tag fixes: {count}",
		notes: []
	};

	// Create pre-formatted lines for each fixed tag
	for (const tagName of fixedTagsArray) {
		const originalTag = TAGS_DETAILED.find((t) => t.name === tagName);
		const fixedTag = updatedTagsDetailed.find((t) => t.name === tagName);

		if (originalTag && fixedTag) {
			const line = `- **${tagName}** → **${fixedTag.commitSha.substring(0, 7)}** (was: ${originalTag.commitSha.substring(0, 7)})`;
			summaryData.lines.push(line);
		}
	}

	// Add appropriate notes
	if (fixedTagsArray.length > 0) {
		summaryData.notes.push(`Successfully retargeted ${fixedTagsArray.length} orphaned tag(s)`);
	} else {
		summaryData.lines.push("- ✅ **No issues found**: All version tags point to reachable commits");
		summaryData.notes.push("All analyzed tags are properly targeting reachable commits");
	}

	const summaryJson = JSON.stringify(summaryData);

	console.log(`🔍 DEBUG: Orphaned tags action summary data:`);
	console.log(JSON.stringify(summaryData, null, 2));

	console.log(`updated-tags-detailed=${updatedTagsJson}`);
	console.log(`fixed-count=${fixedTagsArray.length}`);
	console.log(`fixed-tags=${fixedTagsJson}`);
	console.log(`summary-json=${summaryJson}`); // Write to GitHub output file
	const githubOutput = process.env.GITHUB_OUTPUT;
	if (githubOutput) {
		writeFileSync(
			githubOutput,
			`updated-tags-detailed=${updatedTagsJson}\n` +
				`fixed-count=${fixedTagsArray.length}\n` +
				`fixed-tags=${fixedTagsJson}\n` +
				`summary-json=${summaryJson}\n`,
			{ flag: "a" }
		);
		console.log("🔍 DEBUG: Orphaned tags action outputs written to GITHUB_OUTPUT");
	} else {
		console.log("🔍 DEBUG: No GITHUB_OUTPUT file available");
	}

	console.log("🔍 DEBUG: Orphaned tags action completed successfully");
}
