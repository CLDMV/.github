#!/usr/bin/env node

import fs from "fs";
import { execSync } from "child_process";
import { getTagInfo } from "../../utilities/git-utils.mjs";

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

			const tagInfo = getTagInfo(tag, botPatterns);
			if (!tagInfo) {
				console.log(`⚠️  Could not get info for tag: ${tag}`);
				continue;
			}
			const type = tagInfo.isAnnotated ? "annotated" : tagInfo.isLightweight ? "lightweight" : "unknown";
			console.log(`🏷️  ${tag} (${type}): ${tagInfo.signerName} <${tagInfo.signerEmail}> - ${tagInfo.isBot ? "✅ Bot" : "❌ Not Bot"}`);
			if (!tagInfo.isBot) {
				nonBotTags.push({
					tag,
					sha: tagInfo.commit,
					currentSigner: tagInfo.signerName,
					currentEmail: tagInfo.signerEmail,
					type,
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
