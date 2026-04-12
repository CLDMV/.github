#!/usr/bin/env node

/**
 * Fix Misaligned Major/Minor Version Tags Action
 * Detects and fixes major/minor version tags that don't point to their latest semantic version
 */

import { writeFileSync } from "fs";
import { sh, debugLog } from "../../../common/common/core.mjs";
import { tagExists, getTagInfo } from "../../utilities/git-utils.mjs";
import { run as updateTag } from "../../../github/api/tag/update/_impl.mjs";

/**
 * Create or update a git tag using the proper tag utilities
 * @param {string} tagName - The tag name
 * @param {string} sha - The commit SHA
 * @param {string} message - The tag message
 * @param {boolean} gpgEnabled - Whether to use GPG signing
 */
async function createOrUpdateTag(tagName, sha, message, gpgEnabled = false) {
	console.log(`  🏷️ ${tagExists(tagName) ? "Updating" : "Creating"} tag: ${tagName} -> ${sha}`);
	if (gpgEnabled) {
		console.log(`  🔏 Using GPG signing...`);
	}

	// Get required environment variables for tag operations
	const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	const repo = process.env.GITHUB_REPOSITORY;
	const taggerName = process.env.INPUT_TAGGER_NAME || "";
	const taggerEmail = process.env.INPUT_TAGGER_EMAIL || "";
	const gpgPrivateKey = process.env.INPUT_GPG_PRIVATE_KEY || "";
	const gpgPassphrase = process.env.INPUT_GPG_PASSPHRASE || "";

	// Use the proper tag update utility
	await updateTag({
		token,
		repo,
		tag: tagName,
		sha,
		message,
		gpg_enabled: gpgEnabled,
		tagger_name: taggerName,
		tagger_email: taggerEmail,
		gpg_private_key: gpgPrivateKey,
		gpg_passphrase: gpgPassphrase,
		push: false // We'll push all tags at once later
	});
}

/**
 * Main function to fix misaligned major/minor version tags
 */
async function main() {
	console.log("🎯 Checking for misaligned major/minor version tags...");

	// Get inputs from environment
	const debug = process.env.INPUT_DEBUG === "true";
	const tagsDetailedJson = process.env.INPUT_TAGS_DETAILED || "[]";
	const gpgEnabled = process.env.INPUT_GPG_ENABLED === "true";
	const githubOutput = process.env.GITHUB_OUTPUT;

	let fixedCount = 0;
	const fixedTags = [];

	if (debug) {
		debugLog("Input tags JSON:", tagsDetailedJson);
	}

	// Parse tags JSON
	let tagsData;
	try {
		tagsData = JSON.parse(tagsDetailedJson);
	} catch (error) {
		console.error("❌ Failed to parse tags_detailed JSON:", error.message);
		throw error;
	}

	// Extract semantic version tags and sort them
	const semanticTags = tagsData
		.filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag.name))
		.map((tag) => tag.name)
		.sort((a, b) => {
			// Sort using version comparison
			const aVersion = a.slice(1).split(".").map(Number);
			const bVersion = b.slice(1).split(".").map(Number);

			for (let i = 0; i < 3; i++) {
				if (aVersion[i] !== bVersion[i]) {
					return aVersion[i] - bVersion[i];
				}
			}
			return 0;
		});

	console.log(`📋 Found semantic version tags: ${semanticTags.join(", ")}`);

	// Group by major version and find latest in each group
	const majorVersionGroups = {};

	for (const tag of semanticTags) {
		const majorVersion = parseInt(tag.split(".")[0].slice(1)); // Remove 'v' and get major
		if (!majorVersionGroups[majorVersion]) {
			majorVersionGroups[majorVersion] = [];
		}
		majorVersionGroups[majorVersion].push(tag);
	}

	const majorVersions = Object.keys(majorVersionGroups)
		.map(Number)
		.sort((a, b) => a - b);
	console.log(`🔢 Major versions found: ${majorVersions.join(", ")}`);

	// Process each major version
	for (const majorNum of majorVersions) {
		console.log(`\n🔍 Processing major version: v${majorNum}`);

		const tagsInMajor = majorVersionGroups[majorNum];
		const latestInMajor = tagsInMajor[tagsInMajor.length - 1]; // Last in sorted array

		console.log(`  📌 Latest semantic version in v${majorNum} series: ${latestInMajor}`);

		// Get the commit SHA for the latest semantic version
		const latestTagInfo = getTagInfo(latestInMajor);
		if (!latestTagInfo) {
			console.error(`  ❌ Cannot find commit for tag ${latestInMajor}, skipping`);
			continue;
		}
		const latestSha = latestTagInfo.commit;

		console.log(`  📍 Target SHA: ${latestSha}`);

		// Extract minor version from latest semantic version
		const majorVersion = `v${majorNum}`;
		const minorVersion = latestInMajor.replace(/^(v\d+\.\d+)\.\d+$/, "$1");

		console.log(`  🏷️ Expected tags: ${majorVersion}, ${minorVersion}`);

		// Check and fix major version tag
		if (tagExists(majorVersion)) {
			const currentMajorInfo = getTagInfo(majorVersion);
			const currentMajorSha = currentMajorInfo ? currentMajorInfo.commit : "";
			console.log(`  🔍 Current ${majorVersion} points to: ${currentMajorSha}`);

			if (currentMajorSha !== latestSha) {
				console.log(`  🔧 FIXING: ${majorVersion} should point to ${latestSha} (currently ${currentMajorSha})`);

				const tagMessage = `${majorVersion} → ${latestInMajor}`;
				await createOrUpdateTag(majorVersion, latestSha, tagMessage, gpgEnabled);

				fixedCount++;
				fixedTags.push(majorVersion);
				console.log(`  ✅ Fixed ${majorVersion}`);
			} else {
				console.log(`  ✓ ${majorVersion} is correctly aligned`);
			}
		} else {
			console.log(`  🆕 Major version tag ${majorVersion} does not exist, creating...`);
			const tagMessage = `${majorVersion} → ${latestInMajor}`;
			await createOrUpdateTag(majorVersion, latestSha, tagMessage, gpgEnabled);

			fixedCount++;
			fixedTags.push(majorVersion);
			console.log(`  ✅ Created ${majorVersion}`);
		}

		// Check and fix minor version tag
		if (tagExists(minorVersion)) {
			const currentMinorInfo = getTagInfo(minorVersion);
			const currentMinorSha = currentMinorInfo ? currentMinorInfo.commit : "";
			console.log(`  🔍 Current ${minorVersion} points to: ${currentMinorSha}`);

			if (currentMinorSha !== latestSha) {
				console.log(`  🔧 FIXING: ${minorVersion} should point to ${latestSha} (currently ${currentMinorSha})`);

				const tagMessage = `${minorVersion} → ${latestInMajor}`;
				await createOrUpdateTag(minorVersion, latestSha, tagMessage, gpgEnabled);

				fixedCount++;
				fixedTags.push(minorVersion);
				console.log(`  ✅ Fixed ${minorVersion}`);
			} else {
				console.log(`  ✓ ${minorVersion} is correctly aligned`);
			}
		} else {
			console.log(`  🆕 Minor version tag ${minorVersion} does not exist, creating...`);
			const tagMessage = `${minorVersion} → ${latestInMajor}`;
			await createOrUpdateTag(minorVersion, latestSha, tagMessage, gpgEnabled);

			fixedCount++;
			fixedTags.push(minorVersion);
			console.log(`  ✅ Created ${minorVersion}`);
		}
	}

	console.log(`\n📊 Summary: Fixed ${fixedCount} misaligned major/minor version tags`);

	// Push all fixed tags
	if (fixedCount > 0) {
		console.log(`🚀 Pushing fixed tags: ${fixedTags.join(", ")}`);

		// actions/checkout bakes github.token into git's http.https://github.com/.extraheader
		// config key.  That Basic-auth header takes precedence over URL-embedded credentials and
		// carries only the default runner token, which does NOT have workflows:write permission.
		// Pushing any tag that points to a commit containing .github/workflows/ files is rejected
		// unless the token has workflows:write.  Fix:
		//   1. Unset the checkout-installed extraheader so git uses URL credentials instead.
		//   2. Embed the app token (which has workflows:write) in the remote URL.
		const pushToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
		const repo = process.env.GITHUB_REPOSITORY;
		if (pushToken && repo) {
			// actions/checkout writes the extraheader into the LOCAL repo config (.git/config),
			// not the global config.  We must unset it from --local so git falls back to the
			// URL-embedded credentials below.  git exits 5 when the key isn't present — catch.
			try {
				sh("git config --local --unset-all 'http.https://github.com/.extraheader'");
			} catch {
				// Key not present — nothing to unset, proceed normally.
			}
			sh(`git remote set-url origin https://x-access-token:${pushToken}@github.com/${repo}.git`);
		}

		sh(`git push origin --force ${fixedTags.map((t) => `refs/tags/${t}`).join(" ")}`);
	}

	// Generate summary JSON
	const summary = {
		title: "🎯 Fix Misaligned Major/Minor Tags",
		description: "Corrects major and minor version tags that don't point to their latest semantic versions.",
		lines:
			fixedCount > 0
				? fixedTags.map((tag) => `- ✅ **Fixed tag**: \`${tag}\``)
				: ["- ℹ️ **No fixes needed**: All major/minor tags are correctly aligned"],
		stats_template: "🎯 Misaligned tag fixes: {count}",
		notes:
			fixedCount > 0
				? ["Major version tags now point to their respective latest semantic versions"]
				: ["All major and minor version tags were already correctly aligned"],
		fixed_count: fixedCount,
		fixed_tags: fixedTags
	};

	// Set GitHub outputs
	if (githubOutput) {
		const outputs = [`fixed-count=${fixedCount}`, `summary-json=${JSON.stringify(summary)}`].join("\n") + "\n";

		writeFileSync(githubOutput, outputs, { flag: "a" });
	}

	if (debug) {
		debugLog("Generated summary:", summary);
	}

	console.log("✅ Fix misaligned major/minor tags completed");
}

// Run the main function
main().catch((error) => {
	console.error("❌ Action failed:", error.message);
	process.exit(1);
});
