#!/usr/bin/env node

import { execSync } from "child_process";
import fs from "fs";

/**
 * Get tag information including tagger details
 * @param {string} tagName - The tag name to inspect
 * @returns {Object|null} Tag information or null if not found
 */
function getTagInfo(tagName) {
	try {
		// Get the tag object info (if it's an annotated tag)
		const tagInfo = execSync(`git cat-file -p ${tagName}`, { encoding: "utf8" });

		// Parse tagger info from annotated tag
		const taggerMatch = tagInfo.match(/^tagger (.+) (\d+) ([\+\-]\d{4})$/m);
		if (taggerMatch) {
			const [, nameEmail, timestamp, timezone] = taggerMatch;
			const emailMatch = nameEmail.match(/^(.+) <(.+)>$/);
			const name = emailMatch ? emailMatch[1] : nameEmail;
			const email = emailMatch ? emailMatch[2] : "";

			return {
				type: "annotated",
				tagger: { name, email },
				timestamp: parseInt(timestamp),
				timezone
			};
		}

		// If no tagger info, it might be a lightweight tag
		// Get commit info instead
		const commitSha = execSync(`git rev-list -n 1 ${tagName}`, { encoding: "utf8" }).trim();
		const commitInfo = execSync(`git cat-file -p ${commitSha}`, { encoding: "utf8" });
		const authorMatch = commitInfo.match(/^author (.+) (\d+) ([\+\-]\d{4})$/m);

		if (authorMatch) {
			const [, nameEmail, timestamp, timezone] = authorMatch;
			const emailMatch = nameEmail.match(/^(.+) <(.+)>$/);
			const name = emailMatch ? emailMatch[1] : nameEmail;
			const email = emailMatch ? emailMatch[2] : "";

			return {
				type: "lightweight",
				author: { name, email },
				timestamp: parseInt(timestamp),
				timezone
			};
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

		console.log("🔍 Checking version tags for bot signatures...");
		console.log(`🤖 Bot patterns: ${JSON.stringify(botPatterns)}`);

		const versionTags = getVersionTags();
		console.log(`📋 Found ${versionTags.length} version tags: ${versionTags.join(", ")}`);

		const nonBotTags = [];

		for (const tag of versionTags) {
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
					type: tagInfo.type
				});
			}
		}

		const foundNonBot = nonBotTags.length > 0;

		if (foundNonBot) {
			console.log(`🔧 Found ${nonBotTags.length} non-bot-signed version tags that need to be recreated:`);

			const fixedTagsList = nonBotTags.map((tag) => `${tag.tag} (was: ${tag.currentSigner} <${tag.currentEmail}>)`);

			const jsonPayload = nonBotTags.map((tag) => ({
				tag: tag.tag,
				sha: tag.sha
			}));

			// Set outputs using GitHub Actions format
			const outputFile = process.env.GITHUB_OUTPUT;
			if (outputFile) {
				fs.appendFileSync(outputFile, `non-bot-tags-found=true\n`);
				// Use multiline output format for fixed-tags
				fs.appendFileSync(outputFile, `fixed-tags<<EOF\n${fixedTagsList.join('\n')}\nEOF\n`);
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
