#!/usr/bin/env node

/**
 * Fix Orphaned Tags
 * Fixes tags pointing to orphaned commits by re-pointing to equivalent commits
 */

import { writeFileSync } from "fs";
import { gitCommand } from "../../utilities/git-utils.mjs";
import { importGpgIfNeeded, configureGitIdentity } from "../../../github/api/_api/gpg.mjs";

const DEBUG = process.env.INPUT_DEBUG === "true";
const DRY_RUN = process.env.INPUT_DRY_RUN === "true";
const TAGS_DETAILED = JSON.parse(process.env.INPUT_TAGS_DETAILED || "[]");
const TAGGER_NAME = process.env.INPUT_TAGGER_NAME || "";
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

		// Search for commits with same message and author in current branch
		const searchCommand = `git log --format="%H|%s|%an <%ae>|%ct" --grep="${orphanedMessage.replace(
			/"/g,
			'\\"'
		)}" --author="${orphanedAuthor}" HEAD`;
		const searchResults = gitCommand(searchCommand, true);

		if (!searchResults) {
			// Try broader search with just message
			const broaderSearch = `git log --format="%H|%s|%an <%ae>|%ct" --grep="${orphanedMessage.replace(/"/g, '\\"')}" HEAD`;
			const broaderResults = gitCommand(broaderSearch, true);

			if (broaderResults) {
				const lines = broaderResults.split("\n");
				for (const line of lines) {
					const [sha, message, author, timestamp] = line.split("|");
					if (message === orphanedMessage) {
						console.log(`✅ Found equivalent commit by message: ${sha}`);
						return sha;
					}
				}
			}

			console.warn(`⚠️ No equivalent commit found for orphaned commit ${orphanedCommit}`);
			return null;
		}

		// Parse results and find best match
		const lines = searchResults.split("\n");
		for (const line of lines) {
			const [sha, message, author, timestamp] = line.split("|");

			// Skip if it's the same commit (shouldn't happen in current branch, but safety check)
			if (sha === orphanedCommit) continue;

			// Exact match on message and author
			if (message === orphanedMessage && author === orphanedAuthor) {
				console.log(`✅ Found equivalent commit: ${sha}`);
				return sha;
			}
		}

		// If no exact match, try the first one with same message
		const firstLine = lines[0];
		if (firstLine) {
			const [sha, message] = firstLine.split("|");
			if (message === orphanedMessage) {
				console.log(`✅ Found equivalent commit (different author): ${sha}`);
				return sha;
			}
		}

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
	process.exit(0);
}

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
	process.exit(0);
}

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

// Set outputs
const updatedTagsJson = JSON.stringify(updatedTagsList);
const fixedTagsJson = JSON.stringify(fixedTags);

// Create detailed summary JSON with title, description, and pre-formatted lines
const summaryData = {
	title: "🔗 Fixed Orphaned Tags",
	description: "The following orphaned tags were retargeted:",
	fixed_count: fixedTags.length,
	lines: [],
	stats_template: "🔗 Orphaned tag fixes: {count}",
	notes: []
};

// Create pre-formatted lines for each fixed tag
for (const tagName of fixedTags) {
	const originalTag = orphanedTags.find(t => t.name === tagName);
	const fixedTag = updatedTagsList.find(t => t.name === tagName);
	
	if (originalTag && fixedTag) {
		const line = `- **${tagName}** → **${fixedTag.commitSha.substring(0, 7)}** (was: ${originalTag.commitSha.substring(0, 7)})`;
		summaryData.lines.push(line);
	}
}

// Add notes if any tags were fixed
if (fixedTags.length > 0) {
	summaryData.notes.push(`Successfully retargeted ${fixedTags.length} orphaned tag(s)`);
}

const summaryJson = JSON.stringify(summaryData);

console.log(`updated-tags-detailed=${updatedTagsJson}`);
console.log(`fixed-count=${fixedTags.length}`);
console.log(`fixed-tags=${fixedTagsJson}`);
console.log(`summary-json=${summaryJson}`);

// Write to GitHub output file
const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput) {
	writeFileSync(
		githubOutput,
		`updated-tags-detailed=${updatedTagsJson}\n` +
			`fixed-count=${fixedTags.length}\n` +
			`fixed-tags=${fixedTagsJson}\n` +
			`summary-json=${summaryJson}\n`,
		{ flag: "a" }
	);
}
