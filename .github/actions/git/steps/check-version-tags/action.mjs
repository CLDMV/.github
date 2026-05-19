/**
 * @fileoverview Check whether any semantic version tags (vX.Y.Z) point at the
 * current commit. Node entrypoint for the check-version-tags action.
 * @module @cldmv/.github.git.steps.check-version-tags
 */

import { execSync } from "node:child_process";
import { setOutput } from "../../../common/common/core.mjs";

try {
	const sha = process.env.GITHUB_SHA;
	console.log(`🔍 Checking for version tags pointing to commit ${sha}`);

	const versionTags = execSync(`git tag --points-at ${sha}`, { stdio: ["ignore", "pipe", "inherit"] })
		.toString()
		.split("\n")
		.map((tag) => tag.trim())
		.filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));

	if (versionTags.length > 0) {
		console.log("✅ Found version tags:");
		console.log(versionTags.join("\n"));
		setOutput("has_version_tags", "true");
		setOutput("version_tags", versionTags.join("\n"));
	} else {
		console.log("❌ No version tags found pointing to current commit");
		setOutput("has_version_tags", "false");
		setOutput("version_tags", "");
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
