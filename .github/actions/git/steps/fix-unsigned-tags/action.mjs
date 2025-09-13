#!/usr/bin/env node

/**
 * Fix Unsigned Tags
 * Converts unsigned/lightweight tags to properly signed annotated tags
 */

import { writeFileSync } from "fs";
import { gitCommand, getTagInfo } from "../../utilities/git-utils.mjs";
import { debugLog } from "../../../common/common/core.mjs";
import { importGpgIfNeeded, configureGitIdentity, shouldSign } from "../../../github/api/_api/gpg.mjs";

const DEBUG = process.env.INPUT_DEBUG === "true";
const DRY_RUN = process.env.INPUT_DRY_RUN === "true";
const TAGS_DETAILED = JSON.parse(process.env.INPUT_TAGS_DETAILED || "[]");
const GPG_ENABLED = (process.env.INPUT_GPG_ENABLED || "false").toLowerCase() === "true";
const TAGGER_NAME = process.env.INPUT_TAGGER_NAME || "";
const TAGGER_EMAIL = process.env.INPUT_TAGGER_EMAIL || "";
const GPG_PRIVATE_KEY = process.env.INPUT_GPG_PRIVATE_KEY || "";
const GPG_PASSPHRASE = process.env.INPUT_GPG_PASSPHRASE || "";

/**
 * Check if a tag needs signing/annotation fixes
 * @param {object} tagObj - Tag object from detailed analysis
 * @returns {boolean} True if tag needs fixing
 */
function needsSigningFix(tagObj) {
	// If GPG is enabled, check if it needs to be annotated or signed
	if (GPG_ENABLED) {
		const needsAnnotation = !tagObj.isAnnotated;
		const needsSigning = GPG_PRIVATE_KEY && !tagObj.isSigned;
		return needsAnnotation || needsSigning;
	}
	return false;
}

/**
 * Fix an unsigned/unannotated tag
 * @param {object} tagObj - Tag object to fix
 * @returns {object} Updated tag object or null if failed
 */
function fixUnsignedTag(tagObj) {
	const tagName = tagObj.name;

	try {
		if (DRY_RUN) {
			console.log(`🔐 [DRY RUN] Would convert tag ${tagName} to signed/annotated`);

			// Return updated object for dry run
			return {
				...tagObj,
				isAnnotated: true,
				isSigned: GPG_ENABLED && GPG_PRIVATE_KEY,
				tagger: TAGGER_NAME || "github-actions[bot]"
			};
		}

		console.log(`🔐 Converting tag ${tagName} to signed/annotated tag...`);

		// Get the commit this tag points to
		const commitSha = tagObj.commitSha || gitCommand(`git rev-list -n 1 ${tagName}`, true);
		if (!commitSha) {
			console.error(`❌ Could not find commit for tag ${tagName}`);
			return null;
		}

		// Use existing message or tag name as fallback
		const tagMessage = tagObj.message || tagName;

		// Delete the existing tag locally and remotely
		gitCommand(`git tag -d ${tagName}`, true);
		gitCommand(`git push origin :refs/tags/${tagName}`, true);

		// Create new annotated and potentially signed tag
		let tagCommand = `git tag -a ${tagName} ${commitSha} -m "${tagMessage}"`;

		if (GPG_ENABLED && GPG_PRIVATE_KEY) {
			tagCommand = `git tag -a -s ${tagName} ${commitSha} -m "${tagMessage}"`;
		}

		gitCommand(tagCommand);

		// Push the new tag
		gitCommand(`git push origin ${tagName}`);

		console.log(`✅ Successfully converted tag ${tagName} to signed/annotated`);

		// Return updated tag object
		return {
			...tagObj,
			isAnnotated: true,
			isSigned: GPG_ENABLED && GPG_PRIVATE_KEY,
			tagger: TAGGER_NAME || "github-actions[bot]",
			message: tagMessage
		};
	} catch (error) {
		console.error(`❌ Failed to fix tag ${tagName}: ${error.message}`);
		return null;
	}
}

console.log("🔐 Checking and fixing unsigned/unannotated tags...");

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

console.log(`🔍 Analyzing ${TAGS_DETAILED.length} tags for signing/annotation issues...`);

// Identify tags that need signing/annotation fixes
const unsignedTags = TAGS_DETAILED.filter((tagObj) => needsSigningFix(tagObj));

if (unsignedTags.length === 0) {
	console.log("✅ All tags are properly signed/annotated");

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

console.log(`🔧 Found ${unsignedTags.length} tags needing signing/annotation fixes:`);
unsignedTags.forEach((tagObj) => {
	const status = [];
	if (!tagObj.isAnnotated) status.push("not annotated");
	if (!tagObj.isSigned && GPG_ENABLED && GPG_PRIVATE_KEY) status.push("not signed");
	console.log(`  - ${tagObj.name} (${status.join(", ")})`);
});

// Setup GPG and git identity if signing is enabled
let keyid = "";
if (GPG_ENABLED && GPG_PRIVATE_KEY) {
	keyid = importGpgIfNeeded({ gpg_private_key: GPG_PRIVATE_KEY, gpg_passphrase: GPG_PASSPHRASE });
	debugLog("GPG key imported", { keyid });
}

configureGitIdentity({
	tagger_name: TAGGER_NAME,
	tagger_email: TAGGER_EMAIL,
	keyid,
	enableSign: GPG_ENABLED && GPG_PRIVATE_KEY
});

// Create a copy of the detailed tags list to update
const updatedTagsList = [...TAGS_DETAILED];
const fixedTags = [];

// Fix each unsigned tag
for (const tagObj of unsignedTags) {
	const fixedTagObj = fixUnsignedTag(tagObj);

	if (fixedTagObj) {
		// Update the tag object in the list
		const index = updatedTagsList.findIndex((t) => t.name === tagObj.name);
		if (index !== -1) {
			updatedTagsList[index] = fixedTagObj;
		}
		fixedTags.push(tagObj.name);
	}
}

console.log(`✅ Fixed ${fixedTags.length} unsigned/unannotated tags`);

if (DEBUG) {
	console.log("🔍 Fixed tags details:");
	fixedTags.forEach((tagName) => {
		const tagObj = updatedTagsList.find((t) => t.name === tagName);
		if (tagObj) {
			console.log(`  - ${tagName}: annotated=${tagObj.isAnnotated}, signed=${tagObj.isSigned}`);
		}
	});
}

// Set outputs
const updatedTagsJson = JSON.stringify(updatedTagsList);
const fixedTagsJson = JSON.stringify(fixedTags);

// Create detailed summary JSON with title, description, and pre-formatted lines
const summaryData = {
	unsigned_tag_fixes: {
		title: "🔏 Fixed Unsigned Tags",
		description: "The following tags were converted to signed/annotated tags:",
		fixed_count: fixedTags.length,
		lines: [],
		stats_template: "🔏 Unsigned tag fixes: {count}"
	}
};

// Create pre-formatted lines for each fixed tag
for (const tagName of fixedTags) {
	const originalTag = TAGS_DETAILED.find(t => t.name === tagName);
	const fixedTag = updatedTagsList.find(t => t.name === tagName);
	
	if (originalTag && fixedTag) {
		const status = [];
		if (!originalTag.isAnnotated) status.push("was lightweight");
		if (!originalTag.isSigned) status.push("was unsigned");
		const line = `- **${tagName}** (${status.join(", ")})`;
		summaryData.unsigned_tag_fixes.lines.push(line);
	}
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
