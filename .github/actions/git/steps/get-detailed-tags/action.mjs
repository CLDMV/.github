#!/usr/bin/env node

/**
 * Detailed Tag Analysis Generator
 * Provides comprehensive tag metadata for subsequent fix processes
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";

const DEBUG = process.env.INPUT_DEBUG === "true";
const MAX_TAGS = parseInt(process.env.INPUT_MAX_TAGS || "100");
const MAX_MAJOR_VERSIONS = parseInt(process.env.INPUT_MAX_MAJOR_VERSIONS || "10");
const MAX_MINOR_VERSIONS = parseInt(process.env.INPUT_MAX_MINOR_VERSIONS || "10");
const BOT_PATTERNS = JSON.parse(process.env.INPUT_BOT_PATTERNS || '["CLDMV Bot", "cldmv-bot", "github-actions[bot]"]');
const INCLUDE_PATTERNS = JSON.parse(process.env.INPUT_INCLUDE_PATTERNS || '["v*"]');
const EXCLUDE_PATTERNS = JSON.parse(process.env.INPUT_EXCLUDE_PATTERNS || "[]");

/**
 * Execute git command safely
 * @param {string} command - Git command to execute
 * @param {boolean} silent - Whether to suppress output on error
 * @returns {string} Command output
 */
function gitCommand(command, silent = false) {
	try {
		return execSync(command, {
			encoding: "utf8",
			stdio: silent ? "pipe" : "inherit"
		}).trim();
	} catch (error) {
		if (!silent) {
			console.error(`❌ Command failed: ${command}`);
			console.error(error.message);
		}
		return "";
	}
}

/**
 * Check if tag matches include patterns and doesn't match exclude patterns
 * @param {string} tag - Tag name to check
 * @returns {boolean} Whether tag should be included
 */
function shouldIncludeTag(tag) {
	// Check include patterns
	const includeMatch = INCLUDE_PATTERNS.some((pattern) => {
		const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
		return regex.test(tag);
	});

	if (!includeMatch) return false;

	// Check exclude patterns
	const excludeMatch = EXCLUDE_PATTERNS.some((pattern) => {
		const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
		return regex.test(tag);
	});

	return !excludeMatch;
}

/**
 * Parse semantic version from tag
 * @param {string} tag - Tag name
 * @returns {object|null} Parsed version object or null
 */
function parseVersion(tag) {
	const match = tag.match(/^v?(\d+)\.(\d+)\.(\d+)(.*)$/);
	if (!match) return null;

	return {
		major: parseInt(match[1]),
		minor: parseInt(match[2]),
		patch: parseInt(match[3]),
		suffix: match[4] || ""
	};
}

/**
 * Get comprehensive metadata for a tag
 * @param {string} tag - Tag name
 * @returns {object} Tag metadata object
 */
function getTagMetadata(tag) {
	const metadata = {
		name: tag,
		version: parseVersion(tag),
		exists: true,
		objectType: null,
		commitSha: null,
		commitDate: null,
		tagger: null,
		taggerDate: null,
		message: null,
		isAnnotated: false,
		isSigned: false,
		isBot: false,
		isOrphaned: false,
		error: null
	};

	try {
		// Get object type
		metadata.objectType = gitCommand(`git cat-file -t ${tag}`, true);

		// Get commit SHA
		metadata.commitSha = gitCommand(`git rev-list -n 1 ${tag}`, true);

		// Get commit date
		if (metadata.commitSha) {
			metadata.commitDate = gitCommand(`git log -1 --format=%ct ${metadata.commitSha}`, true);
		}

		// Check if commit is in current branch (orphaned check)
		if (metadata.commitSha) {
			const inHistory = gitCommand(`git merge-base --is-ancestor ${metadata.commitSha} HEAD && echo "yes" || echo "no"`, true);
			metadata.isOrphaned = inHistory === "no";
		}

		if (metadata.objectType === "tag") {
			// Annotated tag
			metadata.isAnnotated = true;
			const tagContent = gitCommand(`git cat-file -p ${tag}`, true);

			// Parse tagger info
			const taggerMatch = tagContent.match(/^tagger (.+) (\d{10,}) ([\+\-]\d{4})$/m);
			if (taggerMatch) {
				metadata.tagger = taggerMatch[1];
				metadata.taggerDate = taggerMatch[2];

				// Check if created by bot
				metadata.isBot = BOT_PATTERNS.some((pattern) => metadata.tagger.toLowerCase().includes(pattern.toLowerCase()));
			}

			// Extract message
			const lines = tagContent.split("\n");
			let messageStarted = false;
			let messageLines = [];

			for (const line of lines) {
				if (line.startsWith("-----BEGIN PGP SIGNATURE-----")) {
					metadata.isSigned = true;
					break;
				}
				if (messageStarted && line.trim()) {
					messageLines.push(line);
				} else if (line.startsWith("tagger ")) {
					messageStarted = true;
				}
			}

			metadata.message = messageLines.join("\n").trim() || tag;
		} else {
			// Lightweight tag
			metadata.isAnnotated = false;
			metadata.message = tag;

			// For lightweight tags, check commit author as "tagger"
			if (metadata.commitSha) {
				const authorInfo = gitCommand(`git log -1 --format="%an <%ae>" ${metadata.commitSha}`, true);
				metadata.tagger = authorInfo;

				// Check if commit was created by bot
				metadata.isBot = BOT_PATTERNS.some((pattern) => authorInfo.toLowerCase().includes(pattern.toLowerCase()));
			}
		}
	} catch (error) {
		metadata.error = error.message;
		metadata.exists = false;
	}

	return metadata;
}

/**
 * Filter tags by major/minor version limits
 * @param {Array} tags - Array of tag objects with version info
 * @returns {Array} Filtered array of tag objects
 */
function applyVersionLimits(tags) {
	// Group by major version
	const majorGroups = new Map();

	for (const tag of tags) {
		if (!tag.version) continue;

		const major = tag.version.major;
		if (!majorGroups.has(major)) {
			majorGroups.set(major, []);
		}
		majorGroups.get(major).push(tag);
	}

	// Sort major versions and take latest N
	const sortedMajors = Array.from(majorGroups.keys()).sort((a, b) => b - a);
	const limitedMajors = sortedMajors.slice(0, MAX_MAJOR_VERSIONS);

	let result = [];

	for (const major of limitedMajors) {
		const majorTags = majorGroups.get(major);

		// Group by minor version within this major
		const minorGroups = new Map();

		for (const tag of majorTags) {
			const minor = tag.version.minor;
			if (!minorGroups.has(minor)) {
				minorGroups.set(minor, []);
			}
			minorGroups.get(minor).push(tag);
		}

		// Sort minor versions and take latest N
		const sortedMinors = Array.from(minorGroups.keys()).sort((a, b) => b - a);
		const limitedMinors = sortedMinors.slice(0, MAX_MINOR_VERSIONS);

		for (const minor of limitedMinors) {
			// Sort patches within minor version (latest first)
			const minorTags = minorGroups.get(minor).sort((a, b) => b.version.patch - a.version.patch);
			result.push(...minorTags);
		}
	}

	// Add non-version tags
	const nonVersionTags = tags.filter((tag) => !tag.version);
	result.push(...nonVersionTags);

	return result;
}

console.log("🏷️ Generating detailed tags list with comprehensive metadata...");

// Fetch all tags to ensure we have complete data
console.log("📡 Fetching tags from remote...");
gitCommand("git fetch --tags --force", true);

// Get all tags
const allTagsOutput = gitCommand("git tag -l", true);
if (!allTagsOutput) {
	console.log("ℹ️ No tags found in repository");
	const output = {
		"tags-detailed": "[]",
		"tags-count": "0",
		"summary": "No tags found in repository"
	};

	Object.entries(output).forEach(([key, value]) => {
		console.log(`${key}=${value}`);
	});

	if (process.env.GITHUB_OUTPUT) {
		const outputContent =
			Object.entries(output)
				.map(([key, value]) => `${key}=${value}`)
				.join("\n") + "\n";
		writeFileSync(process.env.GITHUB_OUTPUT, outputContent, { flag: "a" });
	}

	process.exit(0);
}

const allTags = allTagsOutput.split("\n").filter(Boolean);
if (DEBUG) {
	console.log(`🔍 Found ${allTags.length} total tags`);
}

// Filter tags based on include/exclude patterns
const filteredTags = allTags.filter(shouldIncludeTag);
if (DEBUG) {
	console.log(`🔍 After pattern filtering: ${filteredTags.length} tags`);
}

if (filteredTags.length === 0) {
	console.log("ℹ️ No tags match the specified patterns");
	const output = {
		"tags-detailed": "[]",
		"tags-count": "0",
		"summary": "No tags match the specified patterns"
	};

	Object.entries(output).forEach(([key, value]) => {
		console.log(`${key}=${value}`);
	});

	if (process.env.GITHUB_OUTPUT) {
		const outputContent =
			Object.entries(output)
				.map(([key, value]) => `${key}=${value}`)
				.join("\n") + "\n";
		writeFileSync(process.env.GITHUB_OUTPUT, outputContent, { flag: "a" });
	}

	process.exit(0);
}

// Get detailed metadata for each tag
console.log("🔍 Analyzing tag metadata...");
const detailedTags = filteredTags.map(getTagMetadata);

// Sort by version (latest first) or alphabetically for non-version tags
const sortedTags = detailedTags.sort((a, b) => {
	if (a.version && b.version) {
		// Compare versions
		if (a.version.major !== b.version.major) return b.version.major - a.version.major;
		if (a.version.minor !== b.version.minor) return b.version.minor - a.version.minor;
		if (a.version.patch !== b.version.patch) return b.version.patch - a.version.patch;
		return a.version.suffix.localeCompare(b.version.suffix);
	} else if (a.version && !b.version) {
		return -1; // Version tags come first
	} else if (!a.version && b.version) {
		return 1;
	} else {
		return a.name.localeCompare(b.name); // Alphabetical for non-version tags
	}
});

// Apply version limits
const limitedTags = applyVersionLimits(sortedTags);

// Apply maximum tag limit
let finalTags = limitedTags;
if (finalTags.length > MAX_TAGS) {
	finalTags = finalTags.slice(0, MAX_TAGS);
	console.log(`⚠️ Limited to ${MAX_TAGS} tags for safety`);
}

console.log(`✅ Generated detailed metadata for ${finalTags.length} tags`);

// Generate summary
const summary = {
	total: finalTags.length,
	annotated: finalTags.filter((t) => t.isAnnotated).length,
	lightweight: finalTags.filter((t) => !t.isAnnotated).length,
	signed: finalTags.filter((t) => t.isSigned).length,
	bot: finalTags.filter((t) => t.isBot).length,
	orphaned: finalTags.filter((t) => t.isOrphaned).length,
	withErrors: finalTags.filter((t) => t.error).length
};

const summaryText = `Analyzed ${summary.total} tags: ${summary.annotated} annotated, ${summary.lightweight} lightweight, ${summary.signed} signed, ${summary.bot} bot-created, ${summary.orphaned} orphaned, ${summary.withErrors} with errors`;

if (DEBUG) {
	console.log("🔍 Tag analysis summary:");
	console.log(`  Total: ${summary.total}`);
	console.log(`  Annotated: ${summary.annotated}`);
	console.log(`  Lightweight: ${summary.lightweight}`);
	console.log(`  Signed: ${summary.signed}`);
	console.log(`  Bot-created: ${summary.bot}`);
	console.log(`  Orphaned: ${summary.orphaned}`);
	console.log(`  With errors: ${summary.withErrors}`);

	console.log("\n🔍 Sample tags:");
	finalTags.slice(0, 5).forEach((tag) => {
		console.log(
			`  ${tag.name}: ${tag.isAnnotated ? "annotated" : "lightweight"}, ${tag.isBot ? "bot" : "manual"}, ${
				tag.isOrphaned ? "orphaned" : "in-branch"
			}`
		);
	});
}

// Set outputs
const tagsJson = JSON.stringify(finalTags);
const output = {
	"tags-detailed": tagsJson,
	"tags-count": finalTags.length.toString(),
	"summary": summaryText
};

Object.entries(output).forEach(([key, value]) => {
	console.log(`${key}=${value}`);
});

// Write to GitHub output file
if (process.env.GITHUB_OUTPUT) {
	const outputContent =
		Object.entries(output)
			.map(([key, value]) => `${key}=${value}`)
			.join("\n") + "\n";
	writeFileSync(process.env.GITHUB_OUTPUT, outputContent, { flag: "a" });
}
