#!/usr/bin/env node

import { execSync } from "child_process";
import fs from "fs";
import { debugLog } from "../../../common/common/core.mjs";

/**
 * Get tag information including tagger details and message
 * @param {string} tagName - The tag name to inspect
 * @returns {Object|null} Tag information or null if not found
 */
function getTagInfo(tagName) {
	try {
		// First check if this is an annotated tag by checking the object type
		let tagInfo;
		let isAnnotated = false;
		
		try {
			// Check what type of object the tag points to
			const tagObjectType = execSync(`git cat-file -t ${tagName}`, { encoding: "utf8" }).trim();
			console.log(`🔍 DEBUG: Object type for ${tagName}: ${tagObjectType}`);
			
			if (tagObjectType === 'tag') {
				// It's an annotated tag, get the tag object directly
				tagInfo = execSync(`git cat-file -p ${tagName}`, { encoding: "utf8" });
				isAnnotated = true;
				console.log(`🔍 DEBUG: Successfully found annotated tag object for ${tagName}`);
			} else {
				// It's a lightweight tag pointing directly to a commit
				tagInfo = execSync(`git cat-file -p ${tagName}`, { encoding: "utf8" });
				isAnnotated = false;
				console.log(`🔍 DEBUG: Found lightweight tag ${tagName} pointing to ${tagObjectType}`);
			}
		} catch (tagObjectError) {
			// If that fails, fall back to getting the commit it points to
			console.log(`🔍 DEBUG: Failed to get object type for ${tagName}: ${tagObjectError.message}`);
			tagInfo = execSync(`git cat-file -p ${tagName}`, { encoding: "utf8" });
			isAnnotated = false;
		}
		debugLog(tagInfo);
		debugLog("End of tag info");

		// Parse based on whether it's annotated or lightweight
		if (isAnnotated) {
			// Parse tagger info from annotated tag
			const taggerMatch = tagInfo.match(/^tagger (.+) (\d+) ([\+\-]\d{4})$/m);
			debugLog(`taggerMatch result:`, taggerMatch);
			console.log(`🔍 DEBUG: Checking tagger match for ${tagName} - Match: ${!!taggerMatch}`);
			
			if (taggerMatch) {
				const [, nameEmail, timestamp, timezone] = taggerMatch;
				const emailMatch = nameEmail.match(/^(.+) <(.+)>$/);
				const name = emailMatch ? emailMatch[1] : nameEmail;
				const email = emailMatch ? emailMatch[2] : "";

				// Extract message from annotated tag (everything after the tagger line until PGP signature or end)
				const messageMatch = tagInfo.match(/^tagger .+\n\n([\s\S]*?)(?:\n-----BEGIN PGP SIGNATURE-----[\s\S]*)?$/m);
				const message = messageMatch ? messageMatch[1].trim() : `Update ${tagName}`;

				return {
					type: "annotated",
					tagger: { name, email },
					timestamp: parseInt(timestamp),
					timezone,
					message
				};
			} else {
				console.log(`🔍 DEBUG: No tagger info found in annotated tag ${tagName}, treating as lightweight`);
				isAnnotated = false; // Fall through to lightweight logic
			}
		}
		
		if (!isAnnotated) {
			// Parse author info from commit (lightweight tag)
			const authorMatch = tagInfo.match(/^author (.+) (\d+) ([\+\-]\d{4})$/m);
			debugLog(`authorMatch result:`, authorMatch);
			console.log(`🔍 DEBUG: Checking author match for ${tagName} - Match: ${!!authorMatch}`);
			
			if (authorMatch) {
				const [, nameEmail, timestamp, timezone] = authorMatch;
				const emailMatch = nameEmail.match(/^(.+) <(.+)>$/);
				const name = emailMatch ? emailMatch[1] : nameEmail;
				const email = emailMatch ? emailMatch[2] : "";

				// For lightweight tags, use the commit message as the tag message
				const commitMessage = tagInfo.match(/\n\n([\s\S]*?)$/);
				const message = commitMessage ? commitMessage[1].trim() : `Update ${tagName}`;

				return {
					type: "lightweight",
					author: { name, email },
					timestamp: parseInt(timestamp),
					timezone,
					message
				};
			}
		}

		return null;
	} catch (error) {
		console.error(`Error getting tag info for ${tagName}:`, error.message);
		return null;
	}
}

/**
 * Check if a tagger/author name matches bot patterns
 * @param {string} name - The tagger/author name
 * @param {string[]} botPatterns - Array of bot name patterns
 * @returns {boolean} True if the name matches a bot pattern
 */
function isBotSigned(name, botPatterns) {
	if (!name) return false;

	const lowerName = name.toLowerCase();
	return botPatterns.some((pattern) => lowerName.includes(pattern.toLowerCase()) || lowerName === pattern.toLowerCase());
}

/**
 * Get all version tags (semantic versioning pattern)
 * @returns {string[]} Array of version tag names
 */
function getVersionTags() {
	try {
		const output = execSync("git tag -l", { encoding: "utf8" });
		const allTags = output
			.trim()
			.split("\n")
			.filter((tag) => tag);

		// Filter for version tags (v1, v1.2, v1.2.3 patterns)
		const versionTags = allTags.filter((tag) => /^v\d+(\.\d+)?(\.\d+)?$/.test(tag));

		return versionTags;
	} catch (error) {
		console.error("Error getting version tags:", error.message);
		return [];
	}
}

async function main() {
	try {
		// Parse bot patterns from input
		const botPatternsInput = process.env.BOT_PATTERNS || '["CLDMV Bot", "cldmv-bot"]';
		let botPatterns;

		try {
			botPatterns = JSON.parse(botPatternsInput);
		} catch (parseError) {
			console.error("Error parsing BOT_PATTERNS, using defaults:", parseError.message);
			botPatterns = ["CLDMV Bot", "cldmv-bot"];
		}

		// Parse excluded tags from input (format: "v1 → v1.3.22" lines)
		const excludeTagsInput = process.env.EXCLUDE_TAGS || "";
		const excludeTags = excludeTagsInput
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.map((line) => {
				// Extract tag name from "tag → target" format
				const match = line.match(/^([^\s→]+)/);
				return match ? match[1] : line;
			})
			.filter((tag) => tag.length > 0);

		console.log("🔍 Checking version tags for bot signatures...");
		console.log(`🤖 Bot patterns: ${JSON.stringify(botPatterns)}`);
		if (excludeTags.length > 0) {
			console.log(`🚫 Excluding tags: ${excludeTags.join(", ")}`);
		}

		const versionTags = getVersionTags();
		console.log(`📋 Found ${versionTags.length} version tags: ${versionTags.join(", ")}`);

		const nonBotTags = [];

		for (const tag of versionTags) {
			// Skip tags that are in the exclusion list
			if (excludeTags.includes(tag)) {
				console.log(`🚫 Skipping ${tag} (excluded by previous step)`);
				continue;
			}

			const tagInfo = getTagInfo(tag);

			if (!tagInfo) {
				console.log(`⚠️  Could not get info for tag: ${tag}`);
				continue;
			}

			const signerName = tagInfo.tagger?.name || tagInfo.author?.name || "";
			const signerEmail = tagInfo.tagger?.email || tagInfo.author?.email || "";
			const isBot = isBotSigned(signerName, botPatterns) || isBotSigned(signerEmail, botPatterns);

			console.log(`🏷️  ${tag} (${tagInfo.type}): ${signerName} <${signerEmail}> - ${isBot ? "✅ Bot" : "❌ Not Bot"}`);

			if (!isBot) {
				// Get the commit SHA this tag points to
				const commitSha = execSync(`git rev-list -n 1 ${tag}`, { encoding: "utf8" }).trim();
				nonBotTags.push({
					tag,
					sha: commitSha,
					currentSigner: signerName,
					currentEmail: signerEmail,
					type: tagInfo.type,
					message: tagInfo.message || `Update ${tag}`
				});
			}
		}

		const foundNonBot = nonBotTags.length > 0;

		if (foundNonBot) {
			console.log(`🔧 Found ${nonBotTags.length} non-bot-signed version tags that need to be recreated:`);

			const fixedTagsList = nonBotTags.map((tag) => `${tag.tag} (was: ${tag.currentSigner} <${tag.currentEmail}>)`);

			const jsonPayload = nonBotTags.map((tag) => ({
				tag: tag.tag,
				sha: tag.sha,
				message: tag.message
			}));

			// Set outputs using GitHub Actions format
			const outputFile = process.env.GITHUB_OUTPUT;
			if (outputFile) {
				fs.appendFileSync(outputFile, `non-bot-tags-found=true\n`);
				// Use multiline output format for fixed-tags
				fs.appendFileSync(outputFile, `fixed-tags<<EOF\n${fixedTagsList.join("\n")}\nEOF\n`);
				fs.appendFileSync(outputFile, `non-bot-tags-json=${JSON.stringify(jsonPayload)}\n`);
			}

			console.log("📤 Payload for tag recreation:", JSON.stringify(jsonPayload, null, 2));
		} else {
			console.log("✅ All version tags are properly bot-signed");
			const outputFile = process.env.GITHUB_OUTPUT;
			if (outputFile) {
				fs.appendFileSync(outputFile, `non-bot-tags-found=false\n`);
				fs.appendFileSync(outputFile, `fixed-tags<<EOF\n\nEOF\n`);
				fs.appendFileSync(outputFile, `non-bot-tags-json=[]\n`);
			}
		}
	} catch (error) {
		console.error("❌ Error in fix-non-bot-tags action:", error.message);
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

main();
