/**
 * @fileoverview Write the version-tag operations step summary. Node delegation
 * step of the update-major-version-tags job.
 * @module @cldmv/.github.git.jobs.update-major-version-tags.summary
 */

import { appendSummary } from "../../../common/common/core.mjs";

const orphansFound = process.env.ORPHANS_FOUND === "true";
const fixedOrphans = process.env.FIXED_ORPHANS || "";
const nonBotTagsFound = process.env.NON_BOT_TAGS_FOUND === "true";
const fixedBotSignatures = process.env.FIXED_BOT_SIGNATURES || "";
const updated = process.env.UPDATED === "true";
const majorVersion = process.env.MAJOR_VERSION || "";
const minorVersion = process.env.MINOR_VERSION || "";
const tagName = process.env.TAG_NAME || "";

appendSummary("## 🏷️ Version Tag Operations");
appendSummary("");

if (orphansFound) {
	appendSummary("### 🔧 Fixed Orphaned Tags");
	appendSummary("The following version tags were corrected:");
	appendSummary("");
	for (const line of fixedOrphans.split("\n")) {
		if (line.trim()) appendSummary(`- ${line}`);
	}
	appendSummary("");
}

if (nonBotTagsFound) {
	appendSummary("### 🤖 Fixed Bot Signatures");
	appendSummary("The following version tags were recreated with proper bot signatures:");
	appendSummary("");
	for (const line of fixedBotSignatures.split("\n")) {
		if (line.trim()) appendSummary(`- ${line}`);
	}
	appendSummary("");
}

if (updated) {
	appendSummary("### 📌 Version Tags Updated");
	appendSummary("The following major/minor version tags have been updated:");
	appendSummary("");
	appendSummary(`- \`${majorVersion}\` → \`${tagName}\``);
	appendSummary(`- \`${minorVersion}\` → \`${tagName}\``);
	appendSummary("");
}

if (!orphansFound && !nonBotTagsFound && !updated) {
	appendSummary("✅ All version tags are up to date - no changes needed");
}

appendSummary("");
appendSummary("Workflows can reference major version tags (e.g., `@v1`) for automatic updates.");
