#!/usr/bin/env node

/**
 * Fix Non-Bot Tag Signatures
 * Analyzes detailed tags list, fixes tags not created by bot, returns updated list
 */

import { writeFileSync } from "fs";
import { gitCommand, getTagInfo } from "../../utilities/git-utils.mjs";
import { debugLog } from "../../../common/common/core.mjs";
import { importGpgIfNeeded, configureGitIdentity, shouldSign } from "../../../github/api/_api/gpg.mjs";

console.log("🔍 DEBUG: Bot signature action starting...");

const DEBUG = process.env.INPUT_DEBUG === "true";
const DRY_RUN = process.env.INPUT_DRY_RUN === "true";
const TAGS_DETAILED = JSON.parse(process.env.INPUT_TAGS_DETAILED || "[]");
const BOT_PATTERNS = JSON.parse(process.env.INPUT_BOT_PATTERNS || '["CLDMV Bot", "cldmv-bot", "github-actions[bot]"]');
const GPG_ENABLED = (process.env.INPUT_GPG_ENABLED || "false").toLowerCase() === "true";
const TAGGER_NAME = process.env.INPUT_TAGGER_NAME || "";
const TAGGER_EMAIL = process.env.INPUT_TAGGER_EMAIL || "";
const GPG_PRIVATE_KEY = process.env.INPUT_GPG_PRIVATE_KEY || "";
const GPG_PASSPHRASE = process.env.INPUT_GPG_PASSPHRASE || "";

// Setup signing capability
const willSign = GPG_ENABLED && GPG_PRIVATE_KEY;

console.log(`🔍 DEBUG: Processing ${TAGS_DETAILED.length} tags for bot signature analysis`);

/**
 * Check if tag was created by bot based on patterns
 * @param {object} tagObj - Tag object with metadata
 * @returns {boolean} True if tag was created by bot
 */
function isTagCreatedByBot(tagObj) {
	// Check if already marked as bot
	if (tagObj.isBot !== undefined) {
		return tagObj.isBot;
	}

	// Check tagger for annotated tags
	if (tagObj.isAnnotated && tagObj.tagger) {
		const isBotTag = BOT_PATTERNS.some((pattern) => tagObj.tagger.toLowerCase().includes(pattern.toLowerCase()));

		debugLog(`Tag ${tagObj.name}: Annotated by "${tagObj.tagger}" - Bot: ${isBotTag ? "✅" : "❌"}`);
		return isBotTag;
	}

	// Check author for lightweight tags
	if (tagObj.isLightweight && tagObj.author) {
		const isBotTag = BOT_PATTERNS.some((pattern) => tagObj.author.toLowerCase().includes(pattern.toLowerCase()));

		debugLog(`Tag ${tagObj.name}: Lightweight by "${tagObj.author}" - Bot: ${isBotTag ? "✅" : "❌"}`);
		return isBotTag;
	}

	debugLog(`Tag ${tagObj.name}: Could not determine creator - assuming non-bot`);
	return false;
}

/**
 * Fix a non-bot tag by recreating it with bot signature
 * @param {object} tagObj - Tag object to fix
 * @returns {object|null} Updated tag object or null if failed
 */
function fixNonBotTag(tagObj) {
	try {
		if (DRY_RUN) {
			console.log(`🔄 [DRY RUN] Would recreate tag ${tagObj.name} with bot signature`);
			// Return the tag object as if it was fixed
			return {
				...tagObj,
				tagger: TAGGER_NAME || "CLDMV Bot",
				isBot: true,
				isSigned: willSign
			};
		}

		console.log(`🔄 Recreating tag ${tagObj.name} with bot signature...`);

		// Use original message or tag name as fallback
		const tagMessage = tagObj.message || tagObj.name;

		// Delete the existing tag
		gitCommand(`git tag -d ${tagObj.name}`, true);
		gitCommand(`git push origin :refs/tags/${tagObj.name}`, true);

		// Create new annotated tag with bot signature
		let tagCommand = `git tag -a ${tagObj.name} ${tagObj.commitSha} -m "${tagMessage}"`;

		if (willSign) {
			tagCommand = `git tag -a -s ${tagObj.name} ${tagObj.commitSha} -m "${tagMessage}"`;
		}

		gitCommand(tagCommand);

		// Push the new tag
		gitCommand(`git push origin ${tagObj.name}`);

		console.log(`✅ Successfully recreated tag ${tagObj.name} with bot signature`);

		// Return updated tag object
		const updatedTagInfo = getTagInfo(tagObj.name);
		if (updatedTagInfo) {
			return {
				...updatedTagInfo,
				isBot: true
			};
		}

		return {
			...tagObj,
			tagger: TAGGER_NAME || "CLDMV Bot",
			isBot: true,
			isSigned: willSign
		};
	} catch (error) {
		console.error(`❌ Failed to fix tag ${tagObj.name}: ${error.message}`);
		debugLog(`Failed to fix tag ${tagObj.name}`, { error: error.message });
		return null;
	}
}

console.log("🤖 Analyzing and fixing non-bot tag signatures...");

// Initialize variables for summary generation
let fixedCount = 0;
let updatedTagsDetailed = [];
let fixedTagsArray = [];

if (TAGS_DETAILED.length === 0) {
	console.log("ℹ️ No tags to process");
	const outputs = {
		"updated-tags-detailed": "[]",
		"fixed-count": "0",
		"fixed-tags": "[]"
	};

	Object.entries(outputs).forEach(([key, value]) => {
		console.log(`${key}=${value}`);
	});
	
	// Continue to summary generation instead of exiting
	fixedCount = 0;
	updatedTagsDetailed = TAGS_DETAILED;
	fixedTagsArray = [];
	console.log("🔍 Continuing to summary generation...");
} else {

// Setup git identity and GPG if provided
let keyid = "";

if (willSign) {
	keyid = importGpgIfNeeded({ gpg_private_key: GPG_PRIVATE_KEY, gpg_passphrase: GPG_PASSPHRASE });
}

configureGitIdentity({
	tagger_name: TAGGER_NAME,
	tagger_email: TAGGER_EMAIL,
	keyid,
	enableSign: willSign
});

console.log(`🔍 Analyzing ${TAGS_DETAILED.length} tags for bot signatures...`);

const nonBotTags = [];
const fixedTags = [];

// Analyze each tag
for (const tagObj of TAGS_DETAILED) {
	if (!isTagCreatedByBot(tagObj)) {
		nonBotTags.push(tagObj);
	}
}

if (nonBotTags.length === 0) {
	console.log("✅ All tags are properly created by bot");
	// Return original tags list unchanged
	updatedTagsDetailed.push(...TAGS_DETAILED);
} else {
	console.log(`🔧 Found ${nonBotTags.length} tags needing bot signature fixes:`);
	nonBotTags.forEach((tag) => console.log(`  - ${tag.name}`));

	// Process each tag (both bot and non-bot)
	for (const tagObj of TAGS_DETAILED) {
		if (nonBotTags.some((t) => t.name === tagObj.name)) {
			// This tag needs fixing
			const fixedTag = fixNonBotTag(tagObj);
			if (fixedTag) {
				updatedTagsDetailed.push(fixedTag);
				fixedTags.push(fixedTag.name);
			} else {
				// Keep original if fix failed
				updatedTagsDetailed.push(tagObj);
			}
		} else {
			// Tag is already fine, keep as-is
			updatedTagsDetailed.push(tagObj);
		}
	}
	
	// Set variables for summary generation
	fixedCount = fixedTags.length;
	fixedTagsArray = fixedTags;
}
}

console.log(`✅ Fixed ${fixedTagsArray.length} tags with bot signatures`);

// Create detailed summary JSON with title, description, and pre-formatted lines
const summaryData = {
	title: "🤖 Bot Signature Analysis",
	description:
		fixedTagsArray.length > 0
			? "The following version tags were recreated with proper bot signatures:"
			: "Analyzed version tags for bot signature compliance.",
	fixed_count: fixedTagsArray.length,
	lines: [],
	stats_template: "🤖 Bot signature fixes: {count}",
	notes: []
};

// Create pre-formatted lines for each fixed tag
for (const tagName of fixedTagsArray) {
	const originalTag = TAGS_DETAILED.find((t) => t.name === tagName);

	if (originalTag) {
		const previousTagger = originalTag.tagger || originalTag.author || "unknown";
		const line = `- **${tagName}** (was: ${previousTagger})`;
		summaryData.lines.push(line);
	}
}

// Add appropriate notes
if (fixedTagsArray.length > 0) {
	summaryData.notes.push(`Successfully recreated ${fixedTagsArray.length} tag(s) with proper bot signatures`);
} else {
	summaryData.lines.push("- ✅ **No issues found**: All version tags have proper bot signatures");
	summaryData.notes.push("All analyzed tags already have correct bot signatures");
}

// Set outputs
const outputs = {
	"updated-tags-detailed": JSON.stringify(updatedTagsDetailed),
	"fixed-count": fixedTagsArray.length.toString(),
	"fixed-tags": JSON.stringify(fixedTagsArray),
	"summary-json": JSON.stringify(summaryData)
};

console.log(`🔍 DEBUG: Bot signature action summary data:`);
console.log(JSON.stringify(summaryData, null, 2));

Object.entries(outputs).forEach(([key, value]) => {
	console.log(`${key}=${value}`);
});

// Write to GitHub output file
const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput) {
	const outputContent =
		Object.entries(outputs)
			.map(([key, value]) => `${key}=${value}`)
			.join("\n") + "\n";
	writeFileSync(githubOutput, outputContent, { flag: "a" });
	console.log("🔍 DEBUG: Bot signature action outputs written to GITHUB_OUTPUT");
} else {
	console.log("🔍 DEBUG: No GITHUB_OUTPUT file available");
}

console.log("🔍 DEBUG: Bot signature action completed successfully");
