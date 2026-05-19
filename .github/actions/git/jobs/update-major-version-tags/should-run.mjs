/**
 * @fileoverview Decide whether tag updates should run — true for workflow_call,
 * when version tags exist, when bot signatures were fixed, or when package.json
 * carries a version. Node delegation step of the update-major-version-tags job.
 * @module @cldmv/.github.git.jobs.update-major-version-tags.should-run
 */

import fs from "node:fs";
import { setOutput } from "../../../common/common/core.mjs";

const eventName = process.env.EVENT_NAME || "";
const hasVersionTags = process.env.HAS_VERSION_TAGS === "true";
const nonBotTagsFound = process.env.NON_BOT_TAGS_FOUND === "true";

// package.json is the source of truth even when the vX.Y.Z tag isn't created yet.
let pkgShouldRun = false;
if (fs.existsSync("package.json")) {
	let pkgVersion = "";
	try {
		pkgVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version || "";
	} catch {
		pkgVersion = "";
	}
	if (pkgVersion) {
		console.log(`📦 package.json version: ${pkgVersion}`);
		pkgShouldRun = true;
	}
}

if (eventName === "workflow_call" || hasVersionTags || nonBotTagsFound || pkgShouldRun) {
	setOutput("result", "true");
	console.log(
		`✅ Should run tag updates (event: ${eventName}, has_tags: ${hasVersionTags}, fixed_signatures: ${nonBotTagsFound}, pkg_version: ${pkgShouldRun})`
	);
} else {
	setOutput("result", "false");
	console.log("❌ Skipping tag updates - no version tags found and no signatures fixed");
}
